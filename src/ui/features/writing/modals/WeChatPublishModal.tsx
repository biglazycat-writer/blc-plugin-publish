import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import i18next from 'i18next'
import { Check, Cloud, Copy, Image as ImageIcon, Loader2, Send, SlidersHorizontal, X } from 'lucide-react'
import type { JSONContent } from '@tiptap/core'
import type { WeChatMPDraftImage, WeChatMPMaterial } from '../../../types/models'
import { ImageLibraryPicker } from '../../images/ImageLibraryPicker'
import { docFromMarkdown } from '../../../lib/content-model'
import { publishingApi } from '../../../bridge/publishing-api'
import { exportWechatHtmlFromJson } from '../../../lib/wechat/wechat-export'
import { collectMermaidPngsFromJson, mermaidImageSrc } from '../../../lib/mermaid-inline'
import type { MermaidPng } from '../../../lib/mermaid-render'
import { buildLayoutHtml, planSummary } from '../../../lib/wechat/layout'
import {
  findTheme,
  PLAIN_THEME,
  themeHasStructure,
  type WeChatStyleOverrides,
} from '../../../lib/editor-themes'
import { useThemes } from '../../../lib/editor-themes/theme-store'
import { useThemeId } from '../../../lib/theme'
import { copyWeChatHtml, toWeChatPlain } from '../../../lib/wechat-html'
import { wt } from '../wt'
import './modal.css'

export type PublishDraft = {articleText:string;publishTitle:string;authorName?:string;coverImage?:string;coverMediaID?:string;coverMode?:'2.35_1'|'1_1'|'both';openComment?:boolean;onlyFansCanComment?:boolean;digest?:string;styleOverrides?:WeChatStyleOverrides}
type Props = {
  draft?: PublishDraft
  onDraftChange?: (draft: PublishDraft) => void
  open: boolean
  markdownText: string
  title?: string
  author?: string
}

// LOCAL_IMG_RE matches an in-editor image that lives in the local library.
const LOCAL_IMG_RE = /^\/(?:creation-image|workasset)\/[^"'\s?#]+/

function shouldUploadToWechat(src: string): boolean {
  if (!src) return false
  if (LOCAL_IMG_RE.test(src) || /^data:image\//i.test(src)) return true
  if (!/^https?:\/\//i.test(src)) return false
  // Images already served by WeChat are usable in the editor and do not need a
  // duplicate material upload.
  return !/^https?:\/\/[^/]*mmbiz\.(qpic|qlogo)\.cn\//i.test(src)
}

// WECHAT_SAFE_RE matches data URLs whose MIME is one WeChat accepts as-is. The
// library can hold webp/bmp/svg; WeChat rejects those with 40113, so anything
// else must be re-encoded (the browser decodes them where Go's stdlib cannot).
const WECHAT_SAFE_RE = /^data:image\/(jpeg|png|gif)[;,]/i

// wechatSafeImage keeps jpeg/png/gif untouched, and re-encodes every other
// format via <canvas> to a type WeChat will accept. Transparent sources stay
// PNG (JPEG would composite alpha onto black); opaque ones become JPEG.
export function wechatSafeImage(dataUrl: string, label = wt('wechatPublish.labelImage')): Promise<string> {
  if (WECHAT_SAFE_RE.test(dataUrl)) return Promise.resolve(dataUrl)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error(wt('wechatPublish.imageProcessFailed', { label })))
          return
        }
        ctx.drawImage(img, 0, 0)
        const hasAlpha = hasTransparency(canvas, ctx)
        resolve(hasAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(wt('wechatPublish.imageEncodeFailed', { label })))
      }
    }
    img.onerror = () => reject(new Error(wt('wechatPublish.imageLoadFailed', { label })))
    img.src = dataUrl
  })
}

function hasTransparency(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): boolean {
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true
  }
  return false
}

// collectImageSrcs walks a tiptap doc and returns every distinct article image
// that must be copied into the current WeChat account's material library.
function collectImageSrcs(doc: JSONContent | null): string[] {
  if (!doc) return []
  const found = new Set<string>()
  const walk = (node: JSONContent) => {
    if (node.type === 'image') {
      const src = (node.attrs?.src as string) || ''
      if (shouldUploadToWechat(src)) found.add(src)
    }
    node.content?.forEach(walk)
  }
  doc.content?.forEach(walk)
  return [...found]
}

// buildDocWithHeader prepends an optional author line so the exported body
// carries it. 正文标题不再注入：文档自身的 H1（结构增强主题的封面）已经承担标题。
function buildDocWithHeader(doc: JSONContent, author: string | undefined): JSONContent {
  const head: JSONContent[] = []
  if (author?.trim()) {
    head.push({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'text', text: author.trim(), marks: [{ type: 'textStyle', attrs: { color: '#999999' } }] }],
    })
  }
  if (head.length === 0) return doc
  return { ...doc, content: [...head, ...(doc.content || [])] }
}

// PREVIEW_SHELL wraps the exported HTML in a phone-width, WeChat-reader-like
// page for the srcDoc iframe. Kept inline (no separate helper module).
function previewShell(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<!-- 正文里直接引用的 mmbiz 图片有 Referer 防盗链，预览文档整体禁用来源。 -->
<meta name="referrer" content="no-referrer"><style>
html,body{margin:0;padding:0;background:#f4f5f7;-webkit-font-smoothing:antialiased;}
.wrap{max-width:677px;margin:0 auto;padding:18px 16px 40px;background:#fff;min-height:100vh;box-sizing:border-box;}
</style></head><body><div class="wrap">${html || `<p style="color:#bbb;text-align:center;margin-top:40px">${wt('wechatPublish.previewEmpty')}</p>`}</div></body></html>`
}

// ---- 封面来源与展示比例 -------------------------------------------------
//
// 公众号的图文封面在两种场合被裁成两种比例：头条位是 2.35:1 横幅，次条位是
// 1:1 方图。draft/add 的 cover_info.crop_percent_list 允许把这两个比例的裁剪
// 区域预先上报（归一化坐标，由后端按居中构图计算），不传则由微信客户端自行
// 裁剪——这就是「默认」选项的语义。

// batchget_material 每页最多 20 条，超出会被接口直接拒绝。
const MATERIAL_PAGE_SIZE = 20

type CoverMode = '2.35_1' | '1_1' | 'both'

function ratiosForCoverMode(mode: CoverMode): string[] {
  if (mode === 'both') return ['2.35_1', '1_1']
  return [mode]
}

function formatMaterialTime(seconds?: number): string {
  if (!seconds) return ''
  const date = new Date(seconds * 1000)
  const language = i18next.isInitialized ? i18next.language : 'zh-CN'
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(language)
}

type MaterialPickerProps = {
  open: boolean
  onClose: () => void
  onPick: (material: WeChatMPMaterial) => void
}

/**
 * 分页浏览公众号永久图片素材。选中后直接引用其 media_id 作为封面（后端
 * CreateDraft 对 thumb_media_id 优先采用），不重复上传、不再消耗素材配额。
 * 与 ImageLibraryPicker 同样必须挂到 body：发布面板带 contain 定位会把
 * fixed 遮罩挤进容器。
 */
export function WeChatMaterialPicker({ open, onClose, onPick }: MaterialPickerProps) {
  const { t } = useTranslation(['writing', 'common'])
  const [items, setItems] = useState<WeChatMPMaterial[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadPage = useCallback(async (offset: number, replace: boolean) => {
    setLoading(true)
    setError('')
    try {
      const page = await publishingApi.listWeChatMPMaterial(offset, MATERIAL_PAGE_SIZE)
      const fresh = page.items || []
      setItems((current) => (replace ? fresh : current.concat(fresh)))
      setTotal(page.total_count || 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Reset on every open so a re-open never shows a stale half-page.
    if (open) void loadPage(0, true)
  }, [open, loadPage])

  if (!open) return null

  const hasMore = items.length > 0 && items.length < total

  const pick = (material: WeChatMPMaterial) => {
    onPick(material)
    onClose()
  }

  return createPortal(
    <div className="lbModalOverlay">
      <div className="lbModal gallery">
        <div className="lbModalHeader">
          <span className="lbModalTitle">{t('wechatPublish.materialTitle')}</span>
          <button className="lbModalClose" onClick={onClose} aria-label={t('common:actions.close')}>
            <X size={16} />
          </button>
        </div>
        <div className="lbModalBody wechatMaterialBody">
          {error && <div className="settingsErr">{error}</div>}
          {items.length === 0 && !loading && !error && (
            <div className="wechatMaterialEmpty">{t('wechatPublish.materialEmpty')}</div>
          )}
          {items.length > 0 && (
            <div className="wechatMaterialGrid">
              {items.map((material) => (
                <button
                  key={material.media_id}
                  type="button"
                  className="wechatMaterialCard"
                  onClick={() => pick(material)}
                  title={material.name || material.media_id}
                >
                  {/* mmbiz CDN 按 Referer 防盗链：本应用页面发起的请求会带上
                      wails.localhost 来源，被替换成「未经许可不可引用」占位图；
                      不带 Referer 则放行，故显式关闭。 */}
                  <img className="wechatMaterialThumb" src={material.url} alt={material.name || t('wechatPublish.materialAlt')} loading="lazy" referrerPolicy="no-referrer" />
                  <span className="wechatMaterialName">{material.name || t('wechatPublish.unnamedMaterial')}</span>
                  <span className="wechatMaterialDate">{formatMaterialTime(material.update_time)}</span>
                </button>
              ))}
            </div>
          )}
          {loading && (
            <div className="wechatMaterialLoading"><Loader2 size={14} className="wechatSpin" /> {t('wechatPublish.loadingMaterials')}</div>
          )}
        </div>
        <div className="lbModalFooter wechatMaterialFooter">
          <span className="wechatMaterialCount">
            {total > 0 ? `${items.length} / ${total}` : ''}
          </span>
          {hasMore && (
            <button type="button" className="lbBtn ghost" onClick={() => void loadPage(items.length, false)} disabled={loading}>
              {t('wechatPublish.loadMore')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

type CoverDigestCardProps = {
  title?: string
  onTitleChange: (value: string) => void
  author: string
  digest: string
  coverImage: string
  coverMediaID: string
  coverMode: CoverMode
  openComment: boolean
  onlyFansCanComment: boolean
  onChangeAuthor: (value: string) => void
  onChangeDigest: (value: string) => void
  onChangeMode: (mode: CoverMode) => void
  onToggleComment: (open: boolean) => void
  onToggleFansOnly: (fansOnly: boolean) => void
  onPickLocal: () => void
  onPickMaterial: () => void
  onRemoveCover: () => void
}

/**
 * 公众号后台的「封面和摘要」不是一张表单，而是长成订阅号信息流样子的卡片：
 * 头条位是标题压在 2.35:1 大图上，次条位是标题旁的小方图。这里按同样的视觉
 * 直接操作——点空位选封面、悬停大图出更换入口、摘要和作者就地点击编辑。
 * 卡片呈现的样子即发出后在消息列表里的样子；展示比例切换时整个卡片会在
 * 「头条大图」与「次条小图」两种形态之间切换，而不是仅仅记一个参数。
 */
function CoverDigestCard(props: CoverDigestCardProps) {
  const { t } = useTranslation(['writing', 'common'])
  // auto 未定裁剪时微信默认也以头条样式展示，故除明确选择次条比例外都按大图画。
  const headlineStyle = props.coverMode !== '1_1'
  const coverModeOptions: Array<{ value: CoverMode; label: string; hint: string }> = [
    { value: '2.35_1', label: t('wechatPublish.modeHeadline'), hint: t('wechatPublish.modeHeadlineHint') },
    { value: '1_1', label: t('wechatPublish.modeSquare'), hint: t('wechatPublish.modeSquareHint') },
    { value: 'both', label: t('wechatPublish.modeBoth'), hint: t('wechatPublish.modeBothHint') },
  ]
  const titleText = props.title?.trim() || t('wechatPublish.untitledArticle')
  const coverActions = props.coverImage ? (
    <div className="wccActions">
      <button type="button" onClick={props.onPickLocal}>{t('wechatPublish.changeLocal')}</button>
      <button type="button" onClick={props.onPickMaterial}>{t('wechatPublish.changeMaterial')}</button>
      <button type="button" className="danger" onClick={props.onRemoveCover}>{t('wechatPublish.removeCover')}</button>
    </div>
  ) : null

  return (
    <div className="wccCard">
      <div className="wccHead">
        <span>{t('wechatPublish.coverDigestTitle')}</span>
        <select
          className="wccModeSelect"
          aria-label={t('wechatPublish.modeAria')}
          value={props.coverMode}
          onChange={(event) => props.onChangeMode(event.target.value as CoverMode)}
        >
          {coverModeOptions.map((option) => (
            <option key={option.value} value={option.value} title={option.hint}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* 标题与公众号后台一致地摆在封面之前；改这里，下方大图/次条预览里的
          标题即时跟随。默认取章节标题，只在发布时生效，不回写正文。 */}
      <input
        className="wccTitleInput"
        value={props.title || ''}
        aria-label={t('wechatPublish.publishTitleAria')}
        placeholder={t('wechatPublish.untitledArticle')}
        onChange={(event) => props.onTitleChange(event.target.value)}
      />

      {headlineStyle && (
        <div className={`wccBanner ${props.coverImage ? '' : 'empty'}`}>
          {props.coverImage ? (
            <>
              <img src={props.coverImage} alt={t('wechatPublish.bannerCoverAlt')} referrerPolicy="no-referrer" />
              <div className="wccScrim" />
              <span className="wccBannerTitle">{titleText}</span>
              {props.coverMediaID && <span className="wccBadge">{t('wechatPublish.badgeFromMaterial')}</span>}
              {coverActions}
            </>
          ) : (
            <button type="button" className="wccBannerAdd" onClick={props.onPickLocal}>
              <ImageIcon size={18} />
              <span>{t('wechatPublish.addCover')}</span>
              <small>{t('wechatPublish.addCoverHint')}</small>
            </button>
          )}
        </div>
      )}

      {!headlineStyle && (
        <div className="wccRowItem">
          {props.coverImage ? (
            <img className="wccRowThumb" src={props.coverImage} alt={t('wechatPublish.rowCoverAlt')} referrerPolicy="no-referrer" />
          ) : (
            <button type="button" className="wccRowThumbAdd" onClick={props.onPickLocal}>
              <ImageIcon size={14} />
            </button>
          )}
          <div className="wccRowBody">
            <span className="wccRowTitle">{titleText}</span>
            <span className="wccRowSub">{t('wechatPublish.rowSub')}</span>
          </div>
          {coverActions}
        </div>
      )}

      {props.coverMode === 'both' && (
        <div className="wccNote">{t('wechatPublish.bothNote')}</div>
      )}

      {!props.coverImage && (
        <div className="wccSourceChips">
          <button type="button" onClick={props.onPickLocal}><ImageIcon size={12} /> {t('wechatPublish.sourceLocal')}</button>
          <button type="button" onClick={props.onPickMaterial}><Cloud size={12} /> {t('wechatPublish.sourceMaterial')}</button>
        </div>
      )}

      <label className="wccDigest">
        <textarea
          value={props.digest}
          rows={2}
          maxLength={120}
          placeholder={t('wechatPublish.digestPlaceholder')}
          onChange={(event) => props.onChangeDigest(event.target.value)}
        />
        <span>{Array.from(props.digest).length}/120</span>
      </label>

      <input
        className="wccAuthor"
        value={props.author}
        maxLength={40}
        placeholder={t('wechatPublish.authorPlaceholder')}
        onChange={(event) => props.onChangeAuthor(event.target.value)}
      />

      {/* 留言是 draft/add 官方字段（need_open_comment / only_fans_can_comment）；
          原创声明、赞赏等没有 API，保持后台手动操作。 */}
      <div className="wccSwitches">
        <label className="wccSwitchRow">
          <input type="checkbox" checked={props.openComment} onChange={(event) => props.onToggleComment(event.target.checked)} />
          <span>{t('wechatPublish.openComment')}</span>
          <small>{props.openComment ? t('wechatPublish.openCommentOn') : t('wechatPublish.openCommentOff')}</small>
        </label>
        <label className={`wccSwitchRow ${props.openComment ? '' : 'off'}`}>
          <input
            type="checkbox"
            disabled={!props.openComment}
            checked={props.openComment && props.onlyFansCanComment}
            onChange={(event) => props.onToggleFansOnly(event.target.checked)}
          />
          <span>{t('wechatPublish.fansOnly')}</span>
        </label>
      </div>
    </div>
  )
}

/**
 * WeChat MP publish helper. Renders the current chapter to themed, inline-styled
 * HTML via the ported markdown-nice pipeline (lib/wechat), shows a phone-width
 * live preview, converts article images to data URLs, then submits the draft
 * through the plugin backend and the official MP API, which uploads the
 * images and rewrites their URLs. It never auto-publishes — the final
 * "publish" step stays manual in the WeChat backend.
 */
export function WeChatPublishModal(props: Props) {
  const { t } = useTranslation(['writing', 'common'])
  const { open, markdownText, title, author } = props
  // 主题只有一套 —— 编辑器主题管理里选的那个。发布面板不再有自己的主题偏好，
  // 换主题走顶部工具栏的「主题」菜单，两边始终一致。
  const themes = useThemes()
  const { themeId } = useThemeId()
  const [authorName, setAuthorName] = useState(props.draft?.authorName ?? author ?? '')
  // 发布标题默认取章节标题，但允许在此处改一份「发布用标题」——仅作用于本次
  // 发布与预览，不回写正文。打开弹窗时重置，跟随最新内容。
  const [publishTitle, setPublishTitle] = useState(title || '')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [coverImage, setCoverImage] = useState(props.draft?.coverImage ?? '')
  // 封面来源。coverMediaID 非空表示选自公众号素材库（发布时直接引用
  // media_id）；为空则按本地图片处理，发布时上传并换取永久 media_id。
  const [coverMediaID, setCoverMediaID] = useState(props.draft?.coverMediaID ?? '')
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false)
  // 单篇头条是公众号最常见的发布形态，故默认按 2.35:1 预置裁剪。
  const [coverMode, setCoverMode] = useState<CoverMode>(props.draft?.coverMode ?? '2.35_1')
  // 留言配置直接对应 draft/add 的 need_open_comment / only_fans_can_comment。
  const [openComment, setOpenComment] = useState(props.draft?.openComment ?? false)
  const [onlyFansCanComment, setOnlyFansCanComment] = useState(props.draft?.onlyFansCanComment ?? false)
  const [digest, setDigest] = useState(props.draft?.digest ?? '')
  // Article image src → base64 data URL, resolved lazily when the modal opens.
  // Used to show images in the preview and carry bytes into the draft.
  const [imageData, setImageData] = useState<Record<string, string>>({})
  const [imgLoading, setImgLoading] = useState(false)
  const [imageErrors, setImageErrors] = useState<string[]>([])
  // 位图化后的 mermaid 图表，按源码索引。图表在公众号里只能是图片，所以它们
  // 之后完全按正文图片处理：预览内联 data URL，发草稿时随图片一起上传。
  const [mermaidPngs, setMermaidPngs] = useState<Map<string, MermaidPng>>(new Map())
  const [articleText, setArticleText] = useState(markdownText || '')
  // Keep the initial state empty so each selected theme can expose its own
  // authored defaults. A slider writes an explicit override only after the
  // user adjusts it.
  const [styleOverrides, setStyleOverrides] = useState<WeChatStyleOverrides>(props.draft?.styleOverrides ?? {})
  useEffect(() => {
    if (!open) return
    setAuthorName(props.draft?.authorName ?? author ?? '')
  }, [open, author])

  useEffect(() => {
    if (open) setArticleText(markdownText || '')
  }, [open])

  useEffect(() => {
    if (open) setPublishTitle(title || '')
  }, [open])

  useEffect(() => {
    props.onDraftChange?.({articleText,publishTitle,authorName,coverImage,coverMediaID,coverMode,openComment,onlyFansCanComment,digest,styleOverrides})
  }, [articleText,publishTitle,authorName,coverImage,coverMediaID,coverMode,openComment,onlyFansCanComment,digest,styleOverrides])

  // The source pane is the single editing surface for this publishing mode.
  const doc = useMemo<JSONContent | null>(() => {
    if (!open) return null
    return docFromMarkdown(articleText || '') as JSONContent
  }, [open, articleText])

  const imageSrcs = useMemo(() => collectImageSrcs(doc), [doc])

  // 图表渲染是异步的，导出管线是同步的：开面板时先全部位图化备好。
  useEffect(() => {
    if (!open || !doc) {
      setMermaidPngs(new Map())
      return
    }
    let cancelled = false
    void (async () => {
      const rendered = await collectMermaidPngsFromJson(doc as never)
      if (!cancelled) setMermaidPngs(rendered)
    })()
    return () => {
      cancelled = true
    }
  }, [open, doc])

  // 图表位图的假 src → data URL，和 imageData 合成同一张解析表。
  const mermaidImageData = useMemo(() => {
    const map: Record<string, string> = {}
    for (const [source, png] of mermaidPngs) map[mermaidImageSrc(source)] = png.dataUrl
    return map
  }, [mermaidPngs])

  // Resolve article images before handing the draft to the native page. Remote
  // URLs are fetched by the desktop backend, which avoids browser CORS limits.
  useEffect(() => {
    if (!open || imageSrcs.length === 0) {
      setImageData({})
      setImageErrors([])
      return
    }
    let cancelled = false
    setImgLoading(true)
    ;(async () => {
      const map: Record<string, string> = {}
      const results = await Promise.all(
        imageSrcs.map(async (src) => {
          try {
            return { src, dataUrl: await publishingApi.readImageAsDataURL(src) }
          } catch {
            return { src, dataUrl: '' }
          }
        }),
      )
      const failed: string[] = []
      results.forEach(({ src, dataUrl }) => {
        if (dataUrl) map[src] = dataUrl
        else failed.push(src)
      })
      if (!cancelled) {
        setImageData(map)
        setImageErrors(failed)
        setImgLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, imageSrcs])

  // 编辑器可以不选主题，但公众号导出必须有一套样式 —— 微信里没有样式就是一坨裸
  // HTML。所以无主题时退回只带排版底座、不带任何装饰的默认主题。
  const theme = useMemo(() => findTheme(themeId, themes) ?? PLAIN_THEME, [themeId, themes])
  // 带结构增强的主题走组件渲染管线（生成封面/章节头/目录），其余走 CSS 管线。
  const isLayout = theme ? themeHasStructure(theme) : false

  // Layout themes take the cover title from the document's H1 or the chapter
  // title; the CSS pipeline likewise renders the body as-is — 正文标题不重复注入。
  const docForExport = useMemo(() => {
    if (!doc) return null
    if (isLayout) return doc
    return buildDocWithHeader(doc, authorName)
  }, [doc, isLayout, authorName])

  /**
   * Render with the selected pipeline. `resolveImage` differs between the
   * preview (data URLs, so images are visible) and the draft (original srcs,
   * which the MP API upload step rewrites to mmbiz URLs), so it is a parameter.
   */
  const buildHtml = useCallback(
    (resolveImage: (src: string) => string): string => {
      if (!docForExport || !theme) return ''
      if (isLayout) {
        return buildLayoutHtml(docForExport as Record<string, unknown>, {
          themeId,
          title: publishTitle,
          styleOverrides,
          resolveImage,
          mermaidPngs,
        }).html
      }
      return exportWechatHtmlFromJson(docForExport as Record<string, unknown>, theme, styleOverrides, {
        resolveImage,
        mermaidPngs,
      })
    },
    [docForExport, isLayout, theme, themeId, publishTitle, styleOverrides, mermaidPngs],
  )

  // The plan drives the structure summary chips.
  const plan = useMemo(() => {
    if (!open || !doc || !isLayout) return null
    return buildLayoutHtml(doc as Record<string, unknown>, {
      themeId,
      title: publishTitle,
      styleOverrides,
      mermaidPngs,
    }).plan
  }, [open, doc, isLayout, themeId, publishTitle, styleOverrides, mermaidPngs])

  const summary = useMemo(() => (plan ? planSummary(plan) : null), [plan])

  const html = useMemo(() => {
    if (!open) return ''
    return buildHtml((src) => imageData[src] || mermaidImageData[src] || src)
  }, [open, buildHtml, imageData, mermaidImageData])

  const previewDoc = useMemo(() => previewShell(html), [html])

  if (!open) return null

  const handleCopy = async () => {
    setError('')
    setStatus('')
    try {
      await copyWeChatHtml(html, toWeChatPlain(html))
      setCopied(true)
      setStatus(t('wechatPublish.copyOk'))
      window.setTimeout(() => setCopied(false), 1800)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const handlePublishToWeChat = async () => {
    if (publishing) return
    if (!html.trim()) { setError(t('wechatPublish.noContent')); return }
    if (!publishTitle.trim()) { setError(t('wechatPublish.titleRequired')); return }
    // Narrowed once here so the draft payload below doesn't repeat the guard.
    const articleTitle = publishTitle.trim()
    if (!coverImage.trim()) { setError(t('wechatPublish.coverRequired')); return }

    setPublishing(true)
    setError('')
    setStatus('')

    try {
      // 1. 检查配置
      const config = await publishingApi.getWeChatMPConfig()
      if (!config.secret_configured) {
        setError(t('wechatPublish.configMissing'))
        return
      }

      // 2. 封面两条通道：选自公众号素材库的封面直接引用永久 media_id，不搬
      //    字节；本地选择的必须转成 data URL（/creation-image/ 路径由后端读成
      //    base64，再把微信不支持的 webp/bmp/svg 等重编码为 jpg/png，避免
      //    40113 unsupported file type），上传换取永久 media_id。
      let thumbMediaID = ''
      let thumbURL = ''
      let thumbDataURL = ''
      if (coverMediaID) {
        thumbMediaID = coverMediaID
        thumbURL = coverImage.trim()
      } else {
        let coverDataURL = coverImage.trim()
        if (!/^data:image\//i.test(coverDataURL)) {
          coverDataURL = await publishingApi.readImageAsDataURL(coverDataURL)
        }
        thumbDataURL = await wechatSafeImage(coverDataURL, t('wechatPublish.labelCover'))
        if (!thumbDataURL) {
          setError(t('wechatPublish.coverReadFailed'))
          return
        }
      }

      // Unreadable article images would stay as /creation-image/... links in the draft
      // body, which WeChat never renders — a "success" with dead images. Block
      // here instead of letting the user ship a broken draft.
      if (imageErrors.length > 0) {
        setError(t('wechatPublish.imageErrorsBlocked', { n: imageErrors.length }))
        return
      }

      // 3. 正文图片保持原始 src（后端据此替换成微信 CDN 地址），但字节也要
      //    转成微信接受的格式后再上传。
      setStatus(imageSrcs.length > 0 || mermaidPngs.size > 0 ? t('wechatPublish.uploadingImages') : t('wechatPublish.creatingDraft'))

      const images: WeChatMPDraftImage[] = await Promise.all(
        imageSrcs
          .filter((src) => imageData[src])
          .map(async (src) => ({ placeholder: src, data_url: await wechatSafeImage(imageData[src]) })),
      )

      // 图表位图同样要上传：正文里留的是它的假 src，后端按 placeholder 替换成
      // mmbiz 地址。少了这一步，图表在发出去的文章里就是死图。
      images.push(
        ...(await Promise.all(
          Object.entries(mermaidImageData).map(async ([src, dataUrl]) => ({
            placeholder: src,
            data_url: await wechatSafeImage(dataUrl),
          })),
        )),
      )

      const result = await publishingApi.createWeChatMPDraft({
        title: articleTitle,
        author: authorName.trim(),
        content: buildHtml((src) => src),
        // Array.from splits by code point so a trailing emoji isn't cut into
        // an orphan surrogate pair (substring would send half a glyph).
        digest: digest.trim() || Array.from(articleTitle).slice(0, 54).join(''),
        thumb_media_id: thumbMediaID,
        thumb_data_url: thumbDataURL,
        thumb_url: thumbURL,
        cover_crop_ratios: ratiosForCoverMode(coverMode),
        need_open_comment: openComment,
        only_fans_can_comment: openComment && onlyFansCanComment,
        images,
      })

      setStatus(
        result.failed_images > 0
          ? t('wechatPublish.draftFailedImages', { message: result.message, n: result.failed_images })
          : t('wechatPublish.draftOk', { message: result.message, mediaId: result.media_id }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPublishing(false)
    }
  }

  const rangeFields = [
    ['fontSize', t('wechatPublish.fieldFontSize'), 'px', 13, 20, 1],
    ['lineHeight', t('wechatPublish.fieldLineHeight'), '', 1.4, 2.4, 0.1],
    ['letterSpacing', t('wechatPublish.fieldLetterSpacing'), 'px', -1, 2, 0.1],
    ['paragraphSpacing', t('wechatPublish.fieldParagraphSpacing'), 'em', 0, 1.4, 0.1],
    ['headingScale', t('wechatPublish.fieldHeadingScale'), '', 0.8, 1.3, 0.05],
    ['contentPadding', t('wechatPublish.fieldContentPadding'), 'px', 0, 32, 1],
  ] as const

  const getStyleValue = (key: (typeof rangeFields)[number][0]): number => {
    const override = styleOverrides[key]
    if (override !== undefined) return override
    const layoutTokens = theme?.layout
    if (layoutTokens) {
      if (key === 'fontSize') return layoutTokens.typography.bodySize
      if (key === 'lineHeight') return layoutTokens.typography.bodyLineHeight
      if (key === 'letterSpacing') return layoutTokens.typography.letterSpacing
      if (key === 'paragraphSpacing') return layoutTokens.shape.paragraphGap / layoutTokens.typography.bodySize
      if (key === 'contentPadding') return layoutTokens.shape.pagePadding
    }
    if (key === 'fontSize') return 16
    if (key === 'lineHeight') return 1.9
    if (key === 'letterSpacing') return 0.5
    if (key === 'paragraphSpacing') return 0.6
    if (key === 'headingScale') return 1
    return 2
  }


  return (
    <section className="wechatPublishWorkspace" aria-label={t('wechatPublish.ariaLabel')}>
      <div className="wechatPublishBody">
        <section className="wechatArticleSourcePane" aria-label={t('wechatPublish.sourcePaneTitle')}>
          <div className="wechatPaneHeader">
            <span>{t('wechatPublish.sourcePaneTitle')}</span>
            <span className="wechatPaneHint">{t('wechatPublish.sourcePaneHint')}</span>
          </div>
          <textarea
            className="wechatArticleSource"
            value={articleText}
            onChange={(event) => {
              const value = event.target.value
              setArticleText(value)
            }}
            spellCheck={false}
            aria-label={t('wechatPublish.sourceAria')}
            placeholder={t('wechatPublish.sourcePlaceholder')}
          />
        </section>

        <section className="wechatPublishPreview" aria-label={t('wechatPublish.previewTitle')}>
          <div className="wechatPreviewBar">
            <div className="wechatPreviewBarInfo">
              <span>{t('wechatPublish.previewTitle')}</span>
              <span className="wechatPreviewTheme">{theme?.name ?? ''}</span>
            </div>
            <div className="wechatPreviewActions">
              <button type="button" className="lbBtn" onClick={() => void handleCopy()}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t('wechatPublish.copied') : t('wechatPublish.copyHtml')}
              </button>
              <button type="button" className="lbBtn primary" onClick={() => void handlePublishToWeChat()} disabled={publishing || imgLoading}>
                {publishing ? <Loader2 size={14} className="wechatSpin" /> : <Send size={14} />}
                {publishing ? t('wechatPublish.publishing') : t('wechatPublish.publish')}
              </button>
            </div>
          </div>
          <div className="wechatPhoneFrame">
            <iframe className="wechatPhoneScreen" title={t('wechatPublish.previewFrameTitle')} srcDoc={previewDoc} />
          </div>
        </section>

        <aside className="wechatPublishSettings" aria-label={t('wechatPublish.settingsTitle')}>
          <div className="wechatPaneHeader">
            <span><SlidersHorizontal size={14} /> {t('wechatPublish.settingsTitle')}</span>
            <span className="wechatPaneHint">{t('wechatPublish.settingsHint')}</span>
          </div>

          {/* 封面与摘要卡片：公众号后台同款视觉，卡片即表单、所见即所得。 */}
          <CoverDigestCard
            title={publishTitle}
            onTitleChange={setPublishTitle}
            author={authorName}
            digest={digest}
            coverImage={coverImage}
            coverMediaID={coverMediaID}
            coverMode={coverMode}
            openComment={openComment}
            onlyFansCanComment={onlyFansCanComment}
            onChangeAuthor={setAuthorName}
            onChangeDigest={setDigest}
            onChangeMode={setCoverMode}
            onToggleComment={setOpenComment}
            onToggleFansOnly={setOnlyFansCanComment}
            onPickLocal={() => setCoverPickerOpen(true)}
            onPickMaterial={() => setMaterialPickerOpen(true)}
            onRemoveCover={() => { setCoverImage(''); setCoverMediaID('') }}
          />

          <ImageLibraryPicker
            open={coverPickerOpen}
            onClose={() => setCoverPickerOpen(false)}
            onPick={(asset) => { setCoverImage(asset.file_url); setCoverMediaID('') }}
          />

          <WeChatMaterialPicker
            open={materialPickerOpen}
            onClose={() => setMaterialPickerOpen(false)}
            onPick={(material) => {
              // 素材的 mmbiz URL 可直接用于预览；media_id 走 thumb_media_id 通道。
              setCoverImage(material.url)
              setCoverMediaID(material.media_id)
            }}
          />

          {imageSrcs.length > 0 && (
            <div className="wechatImageNote">
              <ImageIcon size={14} />
              <span>
                {imgLoading
                  ? t('wechatPublish.preparingImages', { n: imageSrcs.length })
                  : imageErrors.length > 0
                    ? t('wechatPublish.brokenImages', { n: imageErrors.length })
                    : t('wechatPublish.imagesWillUpload', { n: imageSrcs.length })}
              </span>
            </div>
          )}

          {summary && (
            <div className="wechatPlanChips">
              <span className="wechatPlanChip">{t('wechatPublish.chaptersChip', { n: summary.chapters })}</span>
              {summary.hasToc && <span className="wechatPlanChip">{t('wechatPublish.tocChip')}</span>}
              {summary.quotes > 0 && <span className="wechatPlanChip">{t('wechatPublish.quotesChip', { n: summary.quotes })}</span>}
            </div>
          )}

          <p className="wechatThemeDesc">{theme ? `${theme.name} · ${theme.description}` : ''}</p>

          <div className="wechatStyleSection">
            <div className="wechatThemeSectionLabel">{t('wechatPublish.styleSectionLabel')}</div>
            {rangeFields.map(([key, label, unit, min, max, step]) => {
              const value = getStyleValue(key)
              return (
                <label className="wechatRangeField" key={key}>
                  <span>{label} <b>{key === 'lineHeight' || key === 'headingScale' ? value.toFixed(2) : value}{unit}</b></span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(event) => setStyleOverrides((current) => ({ ...current, [key]: Number(event.target.value) }))}
                  />
                </label>
              )
            })}
          </div>
        </aside>
      </div>

      {(status || error) && (
        <div className="wechatPublishMsg">
          {status && <div className="settingsOk">{status}</div>}
          {error && <div className="settingsErr">{error}</div>}
        </div>
      )}
    </section>
  )
}

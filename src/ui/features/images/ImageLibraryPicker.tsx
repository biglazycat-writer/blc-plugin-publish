import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Image as ImageIcon, Loader2, Search, Upload, X } from 'lucide-react'
import { sdk, readImage } from '../../bridge/publishing-api'
import { imagePreview, type ImagePreview } from './image-preview'
import './image-picker.css'

type PickerProps = { open: boolean; onClose: () => void; onPick: (asset: { file_url: string }) => void }
type LibraryImage = Awaited<ReturnType<typeof sdk.images.list>>['items'][number]
type PreviewState = { image?: ImagePreview; error?: string }
type Selection = { src: string; name: string; local: boolean; preview: ImagePreview }

export function ImageLibraryPicker({ open, ...props }: PickerProps) {
  return open ? createPortal(<ImagePickerDialog {...props} />, document.body) : null
}

function ImagePickerDialog({ onClose, onPick }: Omit<PickerProps, 'open'>) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(true), reader = useRef<FileReader | null>(null)
  const previewCache = useRef<Record<string, PreviewState>>({})
  const [items, setItems] = useState<LibraryImage[]>([]), [total, setTotal] = useState(0)
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({})
  const [selection, setSelection] = useState<Selection>()
  const [search, setSearch] = useState(''), [request, setRequest] = useState({ query: '', offset: 0 })
  const [loading, setLoading] = useState(true), [readingFile, setReadingFile] = useState(false), [applying, setApplying] = useState(false)
  const [listError, setListError] = useState(''), [error, setError] = useState('')

  useEffect(() => {
    mounted.current = true
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLInputElement>('input[type=search]')?.focus()
    return () => { mounted.current = false; reader.current?.abort(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setRequest(current => current.query === search.trim() ? current : { query: search.trim(), offset: 0 }), 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let active = true
    setLoading(true); setListError('')
    if (!request.offset) { setItems([]); setTotal(0) }
    void sdk.images.list({ ...request, limit: 12 }).then(page => {
      if (!active) return
      setItems(current => request.offset ? [...current, ...page.items] : page.items)
      setTotal(page.total)
    }).catch(error => { if (active) setListError(String(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [request])

  useEffect(() => {
    let active = true, next = 0
    const pending = items.filter(item => !previewCache.current[item.id])
    // Bound concurrent reads so gallery loading leaves the page bridge available.
    const worker = async () => {
      while (active && next < pending.length) {
        const item = pending[next++]
        let result: PreviewState
        try { result = { image: await imagePreview(await readImage(item.src)) } }
        catch (error) { result = { error: String(error) } }
        if (!active) return
        previewCache.current[item.id] = result
        setPreviews(current => ({ ...current, [item.id]: result }))
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker))
    return () => { active = false }
  }, [items])

  const selectFile = async (file: File) => {
    setError('')
    if (!file.type.startsWith('image/')) { setError('请选择图片文件'); return }
    if (file.size > 20 * 1048576) { setError('图片不能超过 20 MiB'); return }
    setReadingFile(true)
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const current = new FileReader(); reader.current = current
        current.onload = () => resolve(String(current.result))
        current.onerror = () => reject(new Error('无法读取本地图片，请重新选择'))
        current.onabort = () => reject(new Error('已取消读取图片'))
        current.readAsDataURL(file)
      })
      const preview = await imagePreview(src)
      if (mounted.current) setSelection({ src, name: file.name, local: true, preview })
    } catch (error) { if (mounted.current) setError(String(error)) }
    finally { if (mounted.current) setReadingFile(false) }
  }

  const apply = async () => {
    if (!selection || applying) return
    setApplying(true); setError('')
    try {
      const src = selection.local ? selection.src : await readImage(selection.src)
      if (!mounted.current) return
      onPick({ file_url: src }); onClose()
    } catch (error) { if (mounted.current) setError(String(error)) }
    finally { if (mounted.current) setApplying(false) }
  }

  return <div className="lbModalOverlay coverPickerBackdrop" onMouseDown={event => { if (event.target === event.currentTarget && !applying) onClose() }}>
    <div ref={dialog} className="lbModal gallery coverPickerDialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!applying) onClose() }
      if (event.key === 'Tab') {
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden])')]
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header className="lbModalHeader"><div><h2 className="lbModalTitle" id={titleId}>选择封面图片</h2><p>从工作区图片库选择，或上传本地图片。</p></div><button type="button" className="lbModalClose" aria-label="关闭封面选择" disabled={applying} onClick={onClose}><X size={18} /></button></header>
      <div className="lbModalBody coverPickerBody">
        <div className="coverPickerToolbar"><label className="coverPickerSearch"><Search size={16} /><input type="search" aria-label="搜索工作区图片" placeholder="搜索图片名称" value={search} onChange={event => setSearch(event.target.value)} /></label><input ref={fileInput} type="file" hidden accept="image/*" aria-label="选择本地图片" disabled={readingFile || applying} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void selectFile(file) }} /><button type="button" className="lbBtn" disabled={readingFile || applying} onClick={() => fileInput.current?.click()}>{readingFile ? <Loader2 size={14} className="wechatSpin" /> : <Upload size={14} />}{readingFile ? '正在读取…' : '上传本地图片'}</button></div>
        <div className="coverPickerContent"><section className="coverPickerLibrary" aria-label="工作区图片库"><header><h3>工作区图片库</h3><small>{loading ? '正在读取…' : `${total} 张图片`}</small></header>
          {listError && <div className="coverPickerError" role="alert">{listError}<button type="button" className="lbBtn" onClick={() => setRequest({ ...request })}>重试</button></div>}
          {!items.length && !loading && !listError && <div className="coverPickerEmpty"><ImageIcon size={32} /><strong>{request.query ? '没有匹配的图片' : '工作区图片库暂无图片'}</strong><span>也可以上传本地图片作为封面。</span></div>}
          <div className="coverPickerGrid">{items.map(item => {
            const preview = previews[item.id]
            const selected = !selection?.local && selection?.src === item.src
            return <button type="button" className={`coverPickerCard${selected ? ' selected' : ''}`} aria-label={`预览 ${item.name}`} aria-pressed={selected} key={item.id} disabled={applying || !preview?.image} title={preview?.error || item.name} onClick={() => { setError(''); setSelection({ src: item.src, name: item.name, local: false, preview: preview!.image! }) }}><span className="coverPickerThumb">{preview?.image ? <img src={preview.image.url} alt={item.name} /> : preview?.error ? <span><ImageIcon size={24} />图片无法读取</span> : <Loader2 size={20} className="wechatSpin" />}{selected && <i><Check size={14} /></i>}</span><span className="coverPickerName">{item.name}</span><small>{preview?.image ? `${preview.image.width} × ${preview.image.height}` : preview?.error ? '读取失败' : '正在加载预览…'}</small></button>
          })}</div>
          {loading && <p className="coverPickerLoading" role="status"><Loader2 size={16} className="wechatSpin" />正在加载图片…</p>}
          {items.length < total && <button type="button" className="lbBtn coverPickerMore" disabled={loading || applying} onClick={() => setRequest({ query: request.query, offset: items.length })}>加载更多</button>}
        </section><aside className="coverPickerPreview" aria-label="已选封面预览"><h3>已选图片</h3>{selection ? <><div className="coverPickerSelectedImage"><img src={selection.preview.url} alt={`已选：${selection.name}`} /></div><strong title={selection.name}>{selection.name}</strong><span>{selection.preview.width} × {selection.preview.height}</span><small>{selection.local ? '本地图片' : '工作区图片库'}</small></> : <div className="coverPickerEmpty"><ImageIcon size={32} /><span>点击图片查看预览</span></div>}<p>支持图片文件，最大 20 MiB。</p></aside></div>
        {error && <p className="coverPickerError" role="alert">{error}</p>}
      </div>
      <footer className="lbModalFooter coverPickerFooter"><span>确认后将替换当前封面。</span><div><button type="button" className="lbBtn" disabled={applying} onClick={onClose}>取消</button><button type="button" className="lbBtn primary" disabled={!selection || applying || readingFile} onClick={() => void apply()}>{applying && <Loader2 size={14} className="wechatSpin" />}{applying ? '正在读取…' : '使用此封面'}</button></div></footer>
    </div>
  </div>
}

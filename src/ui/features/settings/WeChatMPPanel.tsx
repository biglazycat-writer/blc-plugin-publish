import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Check, Globe, Save, TestTube2, Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { publishingApi, sdk } from '../../bridge/publishing-api'
import type { WeChatMPConfig, WeChatMPEgressIP } from '../../types/models'

// 公众号开发接口管理已于 2025-12 迁移到「微信开发者平台」。开发者先到控制台
// 首页（business+dev 标签）点击「公众号」进入项目，再切到「开发」标签查看
// 基本设置里的 AppID/AppSecret 与 IP 白名单。之前的 mp.weixin.qq.com 入口已停用。
const WECHAT_DEVELOPER_CONSOLE = 'https://developers.weixin.qq.com/console/index?tab1=business&tab2=dev'

export type WeChatMPPanelHandle = { save(): Promise<void> }

export const WeChatMPPanel = forwardRef<WeChatMPPanelHandle, { onDirtyChange?: (dirty: boolean) => void }>(function WeChatMPPanel({ onDirtyChange }, ref) {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const [config, setConfig] = useState<WeChatMPConfig | null>(null)
  const [appID, setAppID] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [proxy,setProxy] = useState('')
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detectingIP, setDetectingIP] = useState(false)
  const [egressIP, setEgressIP] = useState<WeChatMPEgressIP | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const dirty = !!config && (appID.trim() !== config.app_id || !!appSecret.trim() || proxy.trim() !== (config.proxy_url || ''))
  // 连接类操作依赖已保存的 AppSecret；按钮常驻显示（配置说明第 3 步指向它），未就绪时置灰并提示。
  const secretReady = !!config?.secret_configured

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useImperativeHandle(ref, () => ({ save: handleSave }))

  useEffect(() => {
    let active = true
    void publishingApi
      .getWeChatMPConfig()
      .then((cfg) => {
        if (active) {
          setConfig(cfg)
          setAppID(cfg.app_id || ''); setProxy(cfg.proxy_url || '')
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : t('wechatmp.loadFailed'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
  }, [])

  async function handleSave() {
    if (!dirty) return
    if (!appID.trim()) {
      setError(t('wechatmp.appIdRequired'))
      throw new Error(t('wechatmp.appIdRequired'))
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const updated = await publishingApi.saveWeChatMPConfig(
        {
          app_id: appID.trim(),
          app_secret: appSecret.trim(),
          proxy_url: proxy.trim(),
          secret_configured: false,
          account_name: '',
          default_author: '',
          last_verified_at: '',
          last_error: '',
        },
        false
      )
      setConfig(updated)
      setAppSecret('') // 保存后清空密钥输入框
      setMessage(t('wechatmp.saved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('wechatmp.saveFailed'))
      throw err
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setError('')
    setMessage('')
    try {
      const updated = await publishingApi.testWeChatMPConnection()
      setConfig(updated)
      if (updated.last_error) {
        setError(updated.last_error)
      } else {
        setMessage(t('wechatmp.testOk'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('wechatmp.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  async function handleDetectIP() {
    setDetectingIP(true)
    setEgressIP(null)
    setError('')
    setMessage('')
    try {
      const result = await publishingApi.detectWeChatMPEgressIP()
      setEgressIP(result)
      if (result.whitelisted) {
        setMessage(result.ip ? t('wechatmp.ipWhitelisted', { ip: result.ip }) : t('wechatmp.ipCheckPassed'))
      } else if (result.ip) {
        setError(t('wechatmp.ipDetected', { ip: result.ip }))
      } else {
        setError(result.message || t('wechatmp.ipCheckRejected'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('wechatmp.ipFailed'))
    } finally {
      setDetectingIP(false)
    }
  }

  function openWeChatConsole() {
    void sdk.ui.openExternal(WECHAT_DEVELOPER_CONSOLE).catch(err => setError(String(err)))
  }

  if (loading) {
    return (
      <div className="settingsPanel">
        <p className="settingsHint">{t('wechatmp.loading')}</p>
      </div>
    )
  }

  return (
    <div className="settingsCardStack">
      <section className="settingsPanel">
        <div className="settingsSectionHead">
          <div>
            <h3>{t('wechatmp.credentials.title')}</h3>
            <p>{t('wechatmp.credentials.subtitle')}</p>
          </div>
        </div>

        <label className="lbField">
          <span className="lbFieldLabel">AppID</span>
          <input
            type="text"
            value={appID}
            disabled={saving}
            onChange={(e) => setAppID(e.target.value)}
            placeholder="wx1234567890abcdef"
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <label className="lbField">
          <span className="lbFieldLabel">
            AppSecret
            {config?.secret_configured && (
              <span className="settingsHint" style={{ marginLeft: '8px', fontSize: '12px' }}>
                {t('wechatmp.credentials.secretConfigured')}
              </span>
            )}
          </span>
          <input
            type="password"
            value={appSecret}
            disabled={saving}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder={config?.secret_configured ? '••••••••••••••••' : t('wechatmp.credentials.secretPlaceholder')}
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <label className="lbField">
          <span className="lbFieldLabel">HTTP(S) 代理（可选）</span>
          <input value={proxy} disabled={saving} onChange={e=>setProxy(e.target.value)} placeholder="http://127.0.0.1:7890" />
        </label>

        <div className="settingsActions">
          <button
            type="button"
            className="lbBtn primary"
            onClick={() => { void handleSave().catch(() => {}) }}
            disabled={saving || !appID.trim() || !dirty}
          >
            <Save size={14} /> {saving ? t('wechatmp.saving') : t('wechatmp.save')}
          </button>

          <button
            type="button"
            className="lbBtn"
            onClick={handleTest}
            disabled={!secretReady || testing || saving || dirty}
            title={secretReady ? undefined : t('wechatmp.needSecret')}
          >
            <TestTube2 size={14} /> {testing ? t('wechatmp.testing') : t('wechatmp.test')}
          </button>

          <button
            type="button"
            className="lbBtn"
            onClick={handleDetectIP}
            disabled={detectingIP || saving || dirty}
            title={secretReady ? undefined : t('wechatmp.egressOnly')}
          >
            <Network size={14} /> {detectingIP ? t('wechatmp.detecting') : t('wechatmp.detect')}
          </button>        </div>

        {config?.last_verified_at && (
          <div className="settingsOk">
            <Check size={14} /> {t('wechatmp.connected')}
            <span className="settingsHint" style={{ marginLeft: '8px' }}>
              {t('wechatmp.lastVerified', { time: new Date(config.last_verified_at).toLocaleString(i18n.language) })}
            </span>
          </div>
        )}

        {egressIP && !egressIP.whitelisted && egressIP.ip && (
          <div className="settingsWarn">
            <Network size={14} /> {t('wechatmp.egressIpLabel')}{egressIP.ip}
            <span className="settingsHint" style={{ display: 'block', marginTop: '4px' }}>
              {t('wechatmp.ipWhitelistHint')}
            </span>
          </div>
        )}

        {message && <div className="settingsOk" role="status">{message}</div>}
        {error && <div className="settingsErr" role="alert">{error}</div>}
      </section>

      <section className="settingsPanel">
        <div className="settingsSectionHead">
          <div>
            <h3>{t('wechatmp.guide.title')}</h3>
            <p>{t('wechatmp.guide.subtitle')}</p>
          </div>
          <button
            type="button"
            className="lbBtn"
            onClick={openWeChatConsole}
            title={t('wechatmp.guide.openConsoleTitle')}
          >
            <Globe size={14} /> {t('wechatmp.guide.openConsole')}
          </button>
        </div>
        <div className="settingsSteps">
          <p className="settingsHint">{t('wechatmp.guide.step1')}</p>
          <p className="settingsHint">{t('wechatmp.guide.step2')}</p>
          <p className="settingsHint">{t('wechatmp.guide.step3')}</p>
          <p className="settingsHint">{t('wechatmp.guide.step4')}</p>
        </div>
      </section>
    </div>
  )
})

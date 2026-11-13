export interface WeChatMPConfig {
  app_id: string
  proxy_url?: string
  app_secret: string
  secret_configured: boolean
  account_name: string
  default_author: string
  last_verified_at: string
  last_error: string
}

export interface WeChatMPEgressIP {
  ip: string
  whitelisted: boolean
  via_proxy: boolean
  message: string
}

export interface WeChatMPMaterial {
  media_id: string
  name: string
  url: string
  update_time: number
}

export interface WeChatMPMaterialPage {
  items: WeChatMPMaterial[]
  total_count: number
  item_count: number
}

/** One article-body image slated for upload to the account's material library. */
export interface WeChatMPDraftImage {
  /** The src exactly as it appears in the article HTML; it is rewired to the CDN URL. */
  placeholder: string
  /** Base64 data URL carrying the actual bytes. */
  data_url: string
}

/** One body-image upload outcome, reported back in input order. */
export interface WeChatMPImageResult {
  placeholder: string
  url: string
  error?: string
}

export interface WeChatMPDraftInput {
  title: string
  author: string
  /** Article HTML. Body images keep their original srcs here; the backend rewires them to CDN URLs. */
  content: string
  digest: string
  /** Permanent-material id already in the library. When empty, thumb_data_url is uploaded instead. */
  thumb_media_id: string
  /** Cover as a data URL or http URL, uploaded to the permanent library when thumb_media_id is empty. */
  thumb_data_url: string
  /**
   * CDN address of a material-library cover. The backend needs only its pixel
   * dimensions (crop coordinates are normalized fractions), so it travels
   * alongside thumb_media_id and no bytes move.
   */
  thumb_url: string
  /** Crop ratios to preset for the cover, e.g. ["2.35_1","1_1"]; empty leaves framing to WeChat. */
  cover_crop_ratios: string[]
  need_open_comment: boolean
  only_fans_can_comment: boolean
  /** Body images uploaded and rewired before the draft is created. */
  images: WeChatMPDraftImage[]
}

export interface WeChatMPDraftResult {
  media_id: string
  images: WeChatMPImageResult[]
  failed_images: number
  thumb_media_id: string
  message: string
}


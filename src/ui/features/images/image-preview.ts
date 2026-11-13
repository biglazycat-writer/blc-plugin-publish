export type ImagePreview = { url: string; width: number; height: number }

/** Keep gallery previews small; selecting a cover still reads the original. */
export function imagePreview(dataUrl: string): Promise<ImagePreview> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error('无法读取这张图片，请选择有效的图片文件'))
    image.onload = () => {
      try {
        const width = image.naturalWidth, height = image.naturalHeight
        if (!width || !height) throw new Error('图片尺寸无效')
        const scale = Math.min(1, 512 / Math.max(width, height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(width * scale))
        canvas.height = Math.max(1, Math.round(height * scale))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('无法生成图片预览')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve({ url: canvas.toDataURL('image/png'), width, height })
      } catch (error) { reject(error) }
    }
    image.src = dataUrl
  })
}

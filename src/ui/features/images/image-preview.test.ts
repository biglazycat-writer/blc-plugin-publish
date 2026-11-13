import { afterEach, expect, it, vi } from 'vitest'
import { imagePreview } from './image-preview'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('keeps tall image previews within 512 pixels while preserving the original dimensions', async () => {
  vi.stubGlobal('Image', class {
    naturalWidth = 2000; naturalHeight = 4000; onload?: () => void
    set src(_value: string) { queueMicrotask(() => this.onload?.()) }
  })
  const draw = vi.fn(), canvases: HTMLCanvasElement[] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) { canvases.push(this); return { drawImage: draw } as unknown as CanvasRenderingContext2D })
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,small')
  const preview = await imagePreview('data:image/png;base64,large')
  expect(preview).toEqual({ url: 'data:image/png;base64,small', width: 2000, height: 4000 })
  expect([canvases[0].width, canvases[0].height]).toEqual([256, 512])
  expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 256, 512)
})
it('rejects image decoding failures', async () => {
  vi.stubGlobal('Image', class {
    onerror?: () => void
    set src(_value: string) { queueMicrotask(() => this.onerror?.()) }
  })
  await expect(imagePreview('invalid-image')).rejects.toThrow('无法读取这张图片')
})

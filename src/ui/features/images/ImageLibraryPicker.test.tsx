import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageLibraryPicker } from './ImageLibraryPicker'

const bridge = vi.hoisted(() => ({ list: vi.fn(), readImage: vi.fn(), preview: vi.fn(), close: vi.fn(), pick: vi.fn() }))
vi.mock('../../bridge/publishing-api', () => ({ sdk: { images: { list: bridge.list } }, readImage: bridge.readImage }))
vi.mock('./image-preview', () => ({ imagePreview: bridge.preview }))

let root: Root, element: HTMLDivElement
const image = (id: string, name = id) => ({ id, name, src: `/creation-image/${id}.png`, width: 1200, height: 800 })
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  bridge.list.mockResolvedValue({ items: [image('cat', '猫咪封面'), image('dog', '狗狗封面')], total: 2 })
  bridge.readImage.mockImplementation(async src => `data:image/png;base64,original-${src}`)
  bridge.preview.mockResolvedValue({ url: 'data:image/png;base64,preview', width: 1200, height: 800 })
  element = document.createElement('div'); document.body.append(element); root = createRoot(element)
})
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.useRealTimers() })
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.coverPickerDialog button')]
const button = (text: string) => buttons().find(button => button.textContent?.trim() === text)!
const card = (name: string) => buttons().find(button => button.getAttribute('aria-label') === `预览 ${name}`)!
async function mount(open = true) { await act(async () => root.render(<ImageLibraryPicker open={open} onPick={bridge.pick} onClose={bridge.close} />)) }
async function click(target: HTMLElement) { await act(async () => target.click()) }
async function search(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[type=search]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 280)) })
}
async function upload(file: File) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 20))
  })
}

describe('cover image picker', () => {
  it('mounts a gallery on the body and applies the original image only after confirmation', async () => {
    await mount()
    const dialog = document.querySelector('[role=dialog]')!
    expect(element.contains(dialog)).toBe(false)
    expect(document.querySelectorAll('.coverPickerThumb img')).toHaveLength(2)
    expect(button('使用此封面').disabled).toBe(true)
    await click(card('猫咪封面'))
    expect(card('猫咪封面').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.coverPickerSelectedImage img')?.getAttribute('alt')).toBe('已选：猫咪封面')
    expect(bridge.pick).not.toHaveBeenCalled()
    bridge.readImage.mockClear()
    await click(button('使用此封面'))
    expect(bridge.readImage).toHaveBeenCalledWith('/creation-image/cat.png')
    expect(bridge.pick).toHaveBeenCalledWith({ file_url: 'data:image/png;base64,original-/creation-image/cat.png' })
    expect(bridge.close).toHaveBeenCalledOnce()
  })

  it('searches the workspace and starts pagination at the current result count', async () => {
    bridge.list.mockResolvedValueOnce({ items: [image('cat', '猫咪封面')], total: 2 })
    await mount()
    expect(bridge.list).toHaveBeenCalledWith({ query: '', offset: 0, limit: 12 })
    bridge.list.mockResolvedValueOnce({ items: [image('dog', '狗狗封面')], total: 2 })
    await click(button('加载更多'))
    expect(bridge.list).toHaveBeenLastCalledWith({ query: '', offset: 1, limit: 12 })
    expect(document.querySelectorAll('.coverPickerCard')).toHaveLength(2)
    bridge.list.mockResolvedValueOnce({ items: [image('cat', '猫咪封面')], total: 1 })
    await search(' 猫咪 ')
    expect(bridge.list).toHaveBeenLastCalledWith({ query: '猫咪', offset: 0, limit: 12 })
    expect(document.querySelectorAll('.coverPickerCard')).toHaveLength(1)
    expect(card('狗狗封面')).toBeUndefined()
    expect(button('加载更多')).toBeUndefined()
  })

  it('ignores a stale response when a search changes before loading finishes', async () => {
    let finish!: (page: unknown) => void
    bridge.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await mount()
    bridge.list.mockResolvedValueOnce({ items: [image('dog', '狗狗封面')], total: 1 })
    await search('狗狗')
    await act(async () => finish({ items: [image('cat', '猫咪封面')], total: 1 }))
    expect(card('狗狗封面')).toBeTruthy()
    expect(card('猫咪封面')).toBeUndefined()
  })

  it('shows empty results and recovers from a list failure', async () => {
    bridge.list.mockRejectedValueOnce(new Error('图片库暂时不可用'))
    await mount()
    expect(document.querySelector('[role=alert]')?.textContent).toContain('图片库暂时不可用')
    bridge.list.mockResolvedValueOnce({ items: [], total: 0 })
    await click(button('重试'))
    expect(document.querySelector('[role=alert]')).toBeNull()
    expect(document.body.textContent).toContain('工作区图片库暂无图片')
    bridge.list.mockResolvedValueOnce({ items: [], total: 0 })
    await search('不存在')
    expect(document.body.textContent).toContain('没有匹配的图片')
  })

  it('displays unreadable images without applying them and retains the selection on confirmation failure', async () => {
    bridge.readImage.mockRejectedValueOnce(new Error('图片已删除'))
    await mount()
    expect(card('猫咪封面').disabled).toBe(true)
    expect(card('猫咪封面').textContent).toContain('图片无法读取')
    await click(card('狗狗封面'))
    bridge.readImage.mockRejectedValueOnce(new Error('原图读取失败'))
    await click(button('使用此封面'))
    expect(document.querySelector('[role=alert]')?.textContent).toContain('原图读取失败')
    expect(bridge.pick).not.toHaveBeenCalled()
    expect(bridge.close).not.toHaveBeenCalled()
    expect(button('使用此封面').disabled).toBe(false)
  })

  it('previews local uploads before applying them and rejects invalid or oversized files', async () => {
    await mount()
    await upload(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    expect(document.querySelector('[role=alert]')?.textContent).toContain('请选择图片文件')
    const large = new File(['image'], 'large.png', { type: 'image/png' })
    Object.defineProperty(large, 'size', { value: 21 * 1048576 })
    await upload(large)
    expect(document.querySelector('[role=alert]')?.textContent).toContain('20 MiB')
    await upload(new File(['image'], 'cover.png', { type: 'image/png' }))
    expect(document.querySelector('.coverPickerSelectedImage img')?.getAttribute('alt')).toBe('已选：cover.png')
    expect(bridge.pick).not.toHaveBeenCalled()
    await click(button('使用此封面'))
    expect(bridge.pick).toHaveBeenCalledWith({ file_url: 'data:image/png;base64,aW1hZ2U=' })
  })

  it('limits preview reads so a page of images cannot fill the plugin bridge', async () => {
    bridge.list.mockResolvedValueOnce({ items: Array.from({ length: 12 }, (_, i) => image(String(i))), total: 12 })
    let active = 0, maximum = 0
    bridge.readImage.mockImplementation(async () => {
      active++; maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 5)); active--
      return 'data:image/png;base64,image'
    })
    await mount()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
    expect(maximum).toBeLessThanOrEqual(3)
    expect(document.querySelectorAll('.coverPickerThumb img')).toHaveLength(12)
  })

  it('cancels without changing the cover, resets on reopen, and restores the original focus', async () => {
    const previous = document.createElement('button'); document.body.append(previous); previous.focus()
    try {
      await mount()
      await click(card('猫咪封面'))
      await click(button('取消'))
      expect(bridge.pick).not.toHaveBeenCalled()
      await mount(false)
      expect(document.activeElement).toBe(previous)
      await mount()
      expect(button('使用此封面').disabled).toBe(true)
      expect(document.querySelectorAll('.coverPickerCard.selected')).toHaveLength(0)
      await act(async () => document.querySelector('input[type=search]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      expect(bridge.close).toHaveBeenCalledTimes(2)
    } finally { previous.remove() }
  })
})

import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { saveAs } from 'file-saver'
import { toPng, toJpeg } from 'html-to-image'
import { useSlidesStore } from '@/store'
import type { Slide } from '@/types/slides'
import { encrypt } from '@/utils/crypto'
import message from '@/utils/message'

interface ExportImageConfig {
  quality: number
  width: number
  fontEmbedCSS?: string
}

/**
 * PPTX export is intentionally owned by the OfficeDex host.
 *
 * The embedded editor keeps image, JSON and .pptist exports local, but it no
 * longer bundles a second PPTX generator. Host integrations should use the
 * presentation editor snapshot/export protocol instead.
 */
export default () => {
  const slidesStore = useSlidesStore()
  const { slides, theme, viewportRatio, title, viewportSize } = storeToRefs(slidesStore)
  const exporting = ref(false)

  const exportImage = (domRef: HTMLElement, format: string, quality: number, ignoreWebfont = true) => {
    exporting.value = true
    const toImage = format === 'png' ? toPng : toJpeg
    const foreignObjectSpans = domRef.querySelectorAll('foreignObject [xmlns]')
    foreignObjectSpans.forEach(spanRef => spanRef.removeAttribute('xmlns'))
    setTimeout(() => {
      const config: ExportImageConfig = { quality, width: 1600 }
      if (ignoreWebfont) config.fontEmbedCSS = ''
      toImage(domRef, config).then(dataUrl => {
        exporting.value = false
        saveAs(dataUrl, `${title.value}.${format}`)
      }).catch(() => {
        exporting.value = false
        message.error('导出图片失败')
      })
    }, 200)
  }

  const pptxExportUnavailable = (onError?: (error: Error) => void) => {
    const error = new Error('PPTX export is handled by the OfficeDex host editor.')
    exporting.value = false
    onError?.(error)
    message.error('请使用 OfficeDex 编辑器导出 PPTX')
  }

  const exportImagePPTX = (_domRefs: NodeListOf<Element>) => {
    pptxExportUnavailable()
  }

  const exportSpecificFile = (_slides: Slide[]) => {
    const json = {
      title: title.value,
      width: viewportSize.value,
      height: viewportSize.value * viewportRatio.value,
      theme: theme.value,
      slides: _slides,
    }
    const blob = new Blob([encrypt(JSON.stringify(json))], { type: '' })
    saveAs(blob, `${title.value}.pptist`)
  }

  const exportJSON = () => {
    const json = {
      title: title.value,
      width: viewportSize.value,
      height: viewportSize.value * viewportRatio.value,
      theme: theme.value,
      slides: slides.value,
    }
    const blob = new Blob([JSON.stringify(json)], { type: 'application/json' })
    saveAs(blob, `${title.value}.json`)
  }

  const exportPPTX = (
    _slides: Slide[],
    _masterOverwrite = false,
    _ignoreMedia = false,
    _onArrayBuffer?: (buffer: ArrayBuffer) => void,
    onError?: (error: Error) => void,
  ) => {
    pptxExportUnavailable(onError)
  }

  return { exporting, exportImage, exportImagePPTX, exportJSON, exportSpecificFile, exportPPTX }
}

<template>
  <SlidePreview v-if="isSlidePreview" />
  <template v-else-if="slides.length">
	    <Screen v-if="screening" />
	    <Editor v-else-if="isEmbedMode || _isPC" />
	    <Mobile v-else />
	    <FullscreenSpin v-if="embedPageRendering" tip="正在渲染页面 ..." loading :mask="false" />
	    <div v-if="embedEditStatus" class="embed-edit-status">{{ embedEditStatus }}</div>
	  </template>
  <FullscreenSpin tip="数据初始化中，请稍等 ..." v-else  loading :mask="false" />
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { nanoid } from 'nanoid'
import { toPng } from 'html-to-image'
import { useScreenStore, useMainStore, useSnapshotStore, useSlidesStore } from '@/store'
import { LOCALSTORAGE_KEY_DISCARDED_DB } from '@/configs/storage'
import { deleteDiscardedDB } from '@/utils/database'
import { isPC } from '@/utils/common'
import useImport from '@/hooks/useImport'
import useExport from '@/hooks/useExport'
import api from '@/services'
import { hasRenderableImages, randomPageRenderDelayMs } from '@/embedAnimation'
import { applyEmbedLocale, normalizeEmbedLocale } from '@/embedLocale'
import { getPptxPerformanceConfig } from '@/utils/pptxPerformanceMode'
import {
  buildAnimatedTextEditFrames,
  getAnimatedTextEditTiming,
  getElementTextEditContent,
  replaceHTMLVisibleTextPreservingMarkup,
} from '@/utils/embedTextAnimation'

import Editor from './views/Editor/index.vue'
import Screen from './views/Screen/index.vue'
import Mobile from './views/Mobile/index.vue'
import SlidePreview from './views/SlidePreview.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'

const _isPC = isPC()

const mainStore = useMainStore()
const slidesStore = useSlidesStore()
const snapshotStore = useSnapshotStore()
const screenStore = useScreenStore()
const { databaseId } = storeToRefs(mainStore)
const { slides } = storeToRefs(slidesStore)
const { screening } = storeToRefs(screenStore)
const embedPageRendering = ref(false)
const embedEditStatus = ref('')

const _mode = new URLSearchParams(window.location.search).get('mode')
const _params = new URLSearchParams(window.location.search)
const isAudienceMode = _mode === 'audience'
const isEmbedPreview = _mode === 'preview'
const isEmbedMode = _mode === 'embed'
const isEmbedEditable = isEmbedMode && _params.get('editable') === '1'
const isSlidePreview = _mode === 'slide-preview'
const embedLocale = normalizeEmbedLocale(_params.get('lang'))

let disposeEmbedLocale: (() => void) | null = null
onMounted(() => {
  if (isEmbedMode) disposeEmbedLocale = applyEmbedLocale(embedLocale)
})
onUnmounted(() => {
  disposeEmbedLocale?.()
  disposeEmbedLocale = null
})

const { importPPTXFile } = useImport()
const { exportPPTX } = useExport()

if (import.meta.env.MODE !== 'development') {
  window.onbeforeunload = () => false
}

function pptistImportLog(event: string, details: Record<string, unknown> = {}) {
  const atMs = Math.round(performance.now())
  const entry = { atMs, ...details }
  console.info('[PPTist][Import]', event, entry)
  window.parent?.postMessage({
    type: 'pptist:import-log',
    event,
    atMs,
    details,
  }, '*')
}

function elapsedSince(startedAt: number) {
  return Math.round(performance.now() - startedAt)
}

const THUMBNAIL_CAPTURE_MIN_IDLE_MS = 24
const THUMBNAIL_CAPTURE_TIMEOUT_MS = 8000
const THUMBNAIL_CAPTURE_RETRY_MS = 180
const THUMBNAIL_CAPTURE_GAP_MS = 240

const pendingThumbnailIds = new Set<string>()
let thumbnailCaptureRunning = false
let thumbnailCapturePaused = false
let thumbnailCaptureEnabled = false
let thumbnailRetryTimer: ReturnType<typeof setTimeout> | null = null

type IdleDeadlineLike = {
  didTimeout: boolean
  timeRemaining: () => number
}

function requestThumbnailIdle(callback: (deadline: IdleDeadlineLike) => void) {
  const requestIdle = window.requestIdleCallback
  if (requestIdle) {
    requestIdle(callback, { timeout: THUMBNAIL_CAPTURE_TIMEOUT_MS })
    return
  }

  setTimeout(() => {
    callback({
      didTimeout: true,
      timeRemaining: () => 0,
    })
  }, THUMBNAIL_CAPTURE_RETRY_MS)
}

// 监听宿主（officedex iframe 父窗口）注入 pptx 数据：{ type: 'pptist:load-pptx', buffer: ArrayBuffer, fileName?: string }
function setupEmbedPreview() {
  slidesStore.setSlides([{ id: nanoid(10), elements: [] }])
  screenStore.setScreening(true)
  snapshotStore.initSnapshotDatabase()

  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data
    if (!data || data.type !== 'pptist:load-pptx' || !data.buffer) return
    const importStartedAt = performance.now()
    pptistImportLog('iframe-preview:load-pptx:received', {
      fileName: data.fileName || 'preview.pptx',
      byteLength: data.buffer.byteLength,
    })
    const file = new File([data.buffer], data.fileName || 'preview.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    importPPTXFile([file], { cover: true }).then(() => {
      pptistImportLog('iframe-preview:import-pptx:end', {
        fileName: file.name,
        slides: slidesStore.slides.length,
        totalMs: elapsedSince(importStartedAt),
      })
    })
  })

  window.parent?.postMessage({ type: 'pptist:preview-ready' }, '*')
}

function captureSlideThumbnail(slideId: string) {
  if (!thumbnailCaptureEnabled) return
  pendingThumbnailIds.add(slideId)
  processThumbnailQueue()
}

function processThumbnailQueue() {
  if (!thumbnailCaptureEnabled) return
  if (thumbnailCapturePaused) return
  if (thumbnailCaptureRunning || pendingThumbnailIds.size === 0) return
  if (thumbnailRetryTimer) {
    clearTimeout(thumbnailRetryTimer)
    thumbnailRetryTimer = null
  }
  thumbnailCaptureRunning = true

  requestThumbnailIdle((deadline) => {
    if (thumbnailCapturePaused) {
      thumbnailCaptureRunning = false
      return
    }
    if (!deadline.didTimeout && deadline.timeRemaining() < THUMBNAIL_CAPTURE_MIN_IDLE_MS) {
      thumbnailCaptureRunning = false
      thumbnailRetryTimer = setTimeout(processThumbnailQueue, THUMBNAIL_CAPTURE_RETRY_MS)
      return
    }

    const nextId = pendingThumbnailIds.values().next().value
    if (!nextId) {
      thumbnailCaptureRunning = false
      return
    }
    pendingThumbnailIds.delete(nextId)
    void captureSlideThumbnailNow(nextId).finally(() => {
      thumbnailCaptureRunning = false
      if (pendingThumbnailIds.size > 0) {
        thumbnailRetryTimer = setTimeout(processThumbnailQueue, THUMBNAIL_CAPTURE_GAP_MS)
      }
    })
  })
}

function captureSlideThumbnailNow(slideId: string) {
  return new Promise<void>((resolve) => {
  nextTick(() => {
    setTimeout(() => {
      if (!thumbnailCaptureEnabled) {
        resolve()
        return
      }
      if (thumbnailCapturePaused) {
        pendingThumbnailIds.add(slideId)
        resolve()
        return
      }
      const thumbnails = document.querySelectorAll('.thumbnail-item')
      const slides = slidesStore.slides
      const slideIndex = slides.findIndex(s => s.id === slideId)
      if (slideIndex < 0) {
        resolve()
        return
      }
      const thumbEl = thumbnails[slideIndex]?.querySelector('.thumbnail-slide') as HTMLElement | null
      if (!thumbEl) {
        resolve()
        return
      }
      if (!thumbEl.querySelector('.elements')) {
        pendingThumbnailIds.add(slideId)
        resolve()
        return
      }
      toPng(thumbEl, { pixelRatio: 2, skipAutoScale: true, cacheBust: true, width: 416, height: Math.round(416 * 0.5625) })
        .then(dataUrl => {
          window.parent?.postMessage({
            type: 'pptist:slide-thumbnail',
            slideId,
            dataUrl,
          }, '*')
        })
        .catch((err) => {
          console.warn('[PPTist] thumbnail capture failed for', slideId, err)
        })
        .finally(resolve)
    }, 300)
  })
  })
}

// Track background state so animation can fast-forward when user returns
let _lastHiddenAt = 0
let _skipAnimDelay = false
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    _lastHiddenAt = Date.now()
  }
  else if (_lastHiddenAt && Date.now() - _lastHiddenAt > 3000) {
    _skipAnimDelay = true
  }
})

const sleep = (ms: number) => new Promise<void>(resolve => {
  if (_skipAnimDelay) { resolve(); return }
  setTimeout(resolve, ms)
})

const nextAnimationFrame = () => new Promise<void>(resolve => {
  if (document.hidden || _skipAnimDelay) {
    resolve()
    return
  }
  window.requestAnimationFrame(() => resolve())
})

let embedProgrammaticUpdateDepth = 0
let embedEditableRestoreFrame: number | null = null
let embedEditableRestoreVersion = 0
let embedFullSlides: any[] | null = null
const embedHydratedSlideIds = new Set<string>()

function isEmbedProgrammaticUpdate() {
  return embedProgrammaticUpdateDepth > 0
}

function beginEmbedProgrammaticUpdate() {
  embedProgrammaticUpdateDepth++
  let released = false
  return () => {
    if (released) return
    released = true
    void nextTick(() => {
      window.requestAnimationFrame(() => {
        embedProgrammaticUpdateDepth = Math.max(0, embedProgrammaticUpdateDepth - 1)
      })
    })
  }
}

function deferEmbedEditableModeForRender() {
  if (!isEmbedEditable) return
  embedEditableRestoreVersion++
  if (embedEditableRestoreFrame !== null) {
    window.cancelAnimationFrame(embedEditableRestoreFrame)
    embedEditableRestoreFrame = null
  }
  mainStore.setEmbedEditableMode(false)
}

function restoreEmbedEditableModeAfterRender() {
  if (!isEmbedEditable) return
  const restoreVersion = embedEditableRestoreVersion
  void nextTick(() => {
    window.requestAnimationFrame(() => {
      embedEditableRestoreFrame = window.requestAnimationFrame(() => {
        if (restoreVersion !== embedEditableRestoreVersion) return
        embedEditableRestoreFrame = null
        mainStore.setEmbedEditableMode(isEmbedEditable)
      })
    })
  })
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function buildEmbedPlaceholderSlide(slide: any) {
  const {
    elements: _elements,
    animations: _animations,
    ...rest
  } = slide || {}

  return {
    ...rest,
    elements: [],
    animations: [],
    __officedexEmbedPlaceholder: true,
  }
}

function isEmbedPlaceholderSlide(slide: any) {
  return Boolean(slide?.__officedexEmbedPlaceholder)
}

function getEmbedInitialHydratedSlideCount() {
  const loadConfig = getPptxPerformanceConfig({
    search: window.location.search,
    embedMode: true,
  }).thumbnailLoad

  return Math.max(1, loadConfig.maxVisible)
}

function buildEmbedInitialSlides(loadedSlides: any[]) {
  embedFullSlides = loadedSlides
  embedHydratedSlideIds.clear()
  const initialHydratedSlideCount = Math.min(loadedSlides.length, getEmbedInitialHydratedSlideCount())
  for (const slide of loadedSlides.slice(0, initialHydratedSlideCount)) {
    if (slide?.id) embedHydratedSlideIds.add(slide.id)
  }

  return loadedSlides.map((slide, index) => index < initialHydratedSlideCount ? slide : buildEmbedPlaceholderSlide(slide))
}

function findEmbedFullSlideById(slideId?: string) {
  if (!slideId || !embedFullSlides) return null
  return embedFullSlides.find(slide => slide?.id === slideId) || null
}

function getEmbedEffectiveSlides() {
  if (!embedFullSlides) return clone(slidesStore.slides)

  return slidesStore.slides.map((slide) => {
    if (!isEmbedPlaceholderSlide(slide)) return clone(slide)
    return clone(findEmbedFullSlideById(slide.id) || slide)
  })
}

function syncEmbedFullSlidesFromCurrentStore() {
  if (!embedFullSlides) return
  embedFullSlides = getEmbedEffectiveSlides()
  embedHydratedSlideIds.clear()
  for (const slide of slidesStore.slides) {
    if (slide?.id && !isEmbedPlaceholderSlide(slide)) embedHydratedSlideIds.add(slide.id)
  }
}

function ensureEmbedSlideHydrated(index: number) {
  if (!embedFullSlides) return slidesStore.slides[index]

  const current = slidesStore.slides[index]
  if (!current) return current
  if (!isEmbedPlaceholderSlide(current)) {
    if (current.id) embedHydratedSlideIds.add(current.id)
    return current
  }

  const fullSlide = findEmbedFullSlideById(current.id)
  if (!fullSlide) return current

  const releaseProgrammaticUpdate = beginEmbedProgrammaticUpdate()
  const nextSlides = [...slidesStore.slides]
  nextSlides[index] = clone(fullSlide)
  slidesStore.setSlides(nextSlides)
  if (fullSlide.id) embedHydratedSlideIds.add(fullSlide.id)
  releaseProgrammaticUpdate()
  return nextSlides[index]
}

function ensureEmbedSlideForOp(op: any) {
  if (!embedFullSlides || !op) return
  if (op.type === 'deck:replace' || op.type === 'slide:add') return

  const index = slideIndexForOp(op)
  if (index >= 0 && index < slidesStore.slides.length) {
    ensureEmbedSlideHydrated(index)
  }
}

function requestEmbedIdle(callback: () => void) {
  const requestIdle = window.requestIdleCallback
  if (requestIdle) {
    requestIdle(callback, { timeout: 2000 })
    return
  }
  setTimeout(callback, 240)
}

function watchEmbedSlideIndexForHydration() {
  watch(
    () => slidesStore.slideIndex,
    (index, previousIndex) => {
      if (!embedFullSlides || index === previousIndex || isEmbedProgrammaticUpdate()) return
      const slide = ensureEmbedSlideHydrated(index)
      if (!slide) return
      pptistImportLog('iframe:slide-index:hydrate-slide', {
        index,
        slideId: slide.id,
        hydratedSlides: embedHydratedSlideIds.size,
      })
    },
    { flush: 'sync' },
  )
}

const PARSED_SLIDES_CACHE_DB = 'officedex-pptist-parsed-slides'
const PARSED_SLIDES_CACHE_STORE = 'parsedSlides'
const PARSED_SLIDES_CACHE_LIMIT = 3

type ParsedSlidesCacheRecord = {
  key: string
  slides: any[]
  updatedAt: number
}

function openParsedSlidesCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const request = indexedDB.open(PARSED_SLIDES_CACHE_DB, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PARSED_SLIDES_CACHE_STORE)) {
        const store = db.createObjectStore(PARSED_SLIDES_CACHE_STORE, { keyPath: 'key' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
    request.onerror = () => resolve(null)
    request.onsuccess = () => resolve(request.result)
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    request.onsuccess = () => resolve(request.result)
  })
}

async function readParsedSlidesCache(key: string): Promise<any[] | null> {
  if (!key) return null
  const db = await openParsedSlidesCacheDb()
  if (!db) return null
  try {
    const tx = db.transaction(PARSED_SLIDES_CACHE_STORE, 'readwrite')
    const store = tx.objectStore(PARSED_SLIDES_CACHE_STORE)
    const record = await requestToPromise<ParsedSlidesCacheRecord | undefined>(store.get(key))
    if (!record?.slides?.length) return null
    await requestToPromise(store.put({ ...record, updatedAt: Date.now() }))
    return record.slides
  }
  finally {
    db.close()
  }
}

async function writeParsedSlidesCache(key: string, slides: any[]) {
  if (!key || !slides.length) return
  const db = await openParsedSlidesCacheDb()
  if (!db) return
  try {
    const tx = db.transaction(PARSED_SLIDES_CACHE_STORE, 'readwrite')
    const store = tx.objectStore(PARSED_SLIDES_CACHE_STORE)
    await requestToPromise(store.put({ key, slides, updatedAt: Date.now() }))
    const allKeys = await requestToPromise<IDBValidKey[]>(store.index('updatedAt').getAllKeys())
    const overflow = allKeys.length - PARSED_SLIDES_CACHE_LIMIT
    for (let i = 0; i < overflow; i++) {
      await requestToPromise(store.delete(allKeys[i]))
    }
  }
  finally {
    db.close()
  }
}

function snapshotForHost() {
  const effectiveSlides = getEmbedEffectiveSlides()
  return {
    slides: effectiveSlides,
    title: slidesStore.title,
    theme: clone(slidesStore.theme),
    viewportSize: slidesStore.viewportSize,
    viewportRatio: slidesStore.viewportRatio,
    slideIndex: slidesStore.slideIndex,
    selectedSlideId: effectiveSlides[slidesStore.slideIndex]?.id,
    selectedElementIds: clone(mainStore.activeElementIdList),
  }
}

function textPreviewForHost(value: unknown) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function elementTextPreviewForHost(element: any) {
  if (!element) return ''
  if (typeof element.content === 'string') return textPreviewForHost(element.content)
  if (element.text && typeof element.text.content === 'string') return textPreviewForHost(element.text.content)
  return ''
}

function selectedElementSummaryForHost(element: any) {
  if (!element?.id) return null
  return {
    id: element.id,
    type: element.type || 'element',
    textPreview: elementTextPreviewForHost(element),
    left: element.left,
    top: element.top,
    width: element.width,
    height: element.height,
    fill: element.fill,
  }
}

function selectionForHost() {
  const effectiveSlides = getEmbedEffectiveSlides()
  const slide = effectiveSlides[slidesStore.slideIndex]
  const elementIds = clone(mainStore.activeElementIdList)
  const elements = elementIds
    .map(id => slide?.elements?.find((element: any) => element.id === id))
    .map(selectedElementSummaryForHost)
    .filter(Boolean)
  return {
    slideId: slide?.id,
    slideIndex: slidesStore.slideIndex,
    elementIds,
    elements,
  }
}

function postSelectionForHost() {
  if (!isEmbedMode) return
  window.parent?.postMessage({
    type: 'pptist:selection-changed',
    selection: selectionForHost(),
  }, '*')
}

watch(
  () => [slidesStore.slideIndex, mainStore.activeElementIdList.join('\u0001')],
  postSelectionForHost,
)

function slideIndexForOp(op: any): number {
  if (typeof op.slideIndex === 'number') return op.slideIndex
  if (typeof op.index === 'number' && !op.slideId) return op.index
  if (op.slideId) return slidesStore.slides.findIndex(slide => slide.id === op.slideId)
  return slidesStore.slideIndex
}

function requireSlideIndex(op: any): number {
  const index = slideIndexForOp(op)
  if (index < 0 || index >= slidesStore.slides.length) throw new Error(`slide not found for ${op.type}`)
  return index
}

function focusEditTarget(op: any) {
  const index = slideIndexForOp(op)
  if (index >= 0 && index < slidesStore.slides.length) slidesStore.updateSlideIndex(index)
  if (op.elementId) mainStore.setActiveElementIdList([op.elementId])
  else mainStore.setActiveElementIdList([])
}

function applyPptistEditOp(op: any) {
  if (!op || typeof op.type !== 'string') throw new Error('invalid edit op')
  focusEditTarget(op)
  switch (op.type) {
    case 'deck:update': {
      if (typeof op.title === 'string') slidesStore.setTitle(op.title)
      if (typeof op.viewportSize === 'number') slidesStore.setViewportSize(op.viewportSize)
      if (typeof op.viewportRatio === 'number') slidesStore.setViewportRatio(op.viewportRatio)
      return
    }
    case 'theme:update': {
      slidesStore.setTheme(op.props || {})
      return
    }
    case 'deck:replace': {
      if (!op.snapshot || !Array.isArray(op.snapshot.slides)) throw new Error('deck:replace requires snapshot.slides')
      slidesStore.setSlides(clone(op.snapshot.slides), op.snapshot.theme || undefined)
      if (typeof op.snapshot.title === 'string') slidesStore.setTitle(op.snapshot.title)
      if (typeof op.snapshot.viewportSize === 'number') slidesStore.setViewportSize(op.snapshot.viewportSize)
      if (typeof op.snapshot.viewportRatio === 'number') slidesStore.setViewportRatio(op.snapshot.viewportRatio)
      slidesStore.updateSlideIndex(Math.max(0, Math.min(op.snapshot.slideIndex || 0, slidesStore.slides.length - 1)))
      return
    }
    case 'slide:add': {
      if (!op.slide) throw new Error('slide:add requires slide')
      const next = clone(slidesStore.slides)
      const index = typeof op.index === 'number' ? Math.max(0, Math.min(op.index, next.length)) : next.length
      next.splice(index, 0, clone(op.slide))
      slidesStore.setSlides(next)
      slidesStore.updateSlideIndex(index)
      return
    }
    case 'slide:replace': {
      if (!op.slide) throw new Error('slide:replace requires slide')
      const index = requireSlideIndex(op)
      const next = clone(slidesStore.slides)
      next[index] = clone(op.slide)
      slidesStore.setSlides(next)
      slidesStore.updateSlideIndex(index)
      return
    }
    case 'slide:update': {
      const index = requireSlideIndex(op)
      slidesStore.updateSlide({ ...(op.props || {}) }, slidesStore.slides[index].id)
      return
    }
    case 'slide:delete': {
      const index = requireSlideIndex(op)
      if (slidesStore.slides.length <= 1) throw new Error('cannot delete the only slide')
      slidesStore.deleteSlide(slidesStore.slides[index].id)
      return
    }
    case 'slide:move': {
      const from = typeof op.fromIndex === 'number' ? op.fromIndex : requireSlideIndex(op)
      const to = Math.max(0, Math.min(op.toIndex, slidesStore.slides.length - 1))
      if (from < 0 || from >= slidesStore.slides.length) throw new Error('slide:move source not found')
      const next = clone(slidesStore.slides)
      const [slide] = next.splice(from, 1)
      next.splice(to, 0, slide)
      slidesStore.setSlides(next)
      slidesStore.updateSlideIndex(to)
      return
    }
    case 'element:add': {
      if (!op.element) throw new Error('element:add requires element')
      const index = requireSlideIndex(op)
      const next = clone(slidesStore.slides)
      const elements = next[index].elements || []
      const insertAt = typeof op.index === 'number' ? Math.max(0, Math.min(op.index, elements.length)) : elements.length
      elements.splice(insertAt, 0, clone(op.element))
      next[index] = { ...next[index], elements }
      slidesStore.setSlides(next)
      slidesStore.updateSlideIndex(index)
      if (op.element.id) mainStore.setActiveElementIdList([op.element.id])
      return
    }
    case 'element:update': {
      if (!op.elementId) throw new Error('element:update requires elementId')
      const index = requireSlideIndex(op)
      const slide = slidesStore.slides[index]
      if (!slide.elements?.some(el => el.id === op.elementId)) throw new Error(`element not found: ${op.elementId}`)
      slidesStore.updateElement({ id: op.elementId, slideId: slide.id, props: op.props || {} })
      mainStore.setActiveElementIdList([op.elementId])
      return
    }
    case 'element:update-text': {
      if (!op.elementId) throw new Error('element:update-text requires elementId')
      if (typeof op.text !== 'string') throw new Error('element:update-text requires text')
      const index = requireSlideIndex(op)
      const slide = slidesStore.slides[index]
      const element = slide.elements?.find((el: any) => el.id === op.elementId) as any
      if (!element) throw new Error(`element not found: ${op.elementId}`)
      if (element.type === 'text' && typeof element.content === 'string') {
        slidesStore.updateElement({
          id: op.elementId,
          slideId: slide.id,
          props: { content: replaceHTMLVisibleTextPreservingMarkup(element.content, op.text) },
        })
        mainStore.setActiveElementIdList([op.elementId])
        return
      }
      if (element.type === 'shape' && element.text && typeof element.text.content === 'string') {
        slidesStore.updateElement({
          id: op.elementId,
          slideId: slide.id,
          props: { text: { ...element.text, content: replaceHTMLVisibleTextPreservingMarkup(element.text.content, op.text) } },
        })
        mainStore.setActiveElementIdList([op.elementId])
        return
      }
      throw new Error(`element is not text-editable: ${op.elementId}`)
    }
    case 'element:delete': {
      if (!op.elementId) throw new Error('element:delete requires elementId')
      const index = requireSlideIndex(op)
      const next = clone(slidesStore.slides)
      next[index].elements = (next[index].elements || []).filter((el: any) => el.id !== op.elementId)
      slidesStore.setSlides(next)
      mainStore.setActiveElementIdList([])
      return
    }
    case 'element:move': {
      if (!op.elementId) throw new Error('element:move requires elementId')
      const index = requireSlideIndex(op)
      const next = clone(slidesStore.slides)
      const elements = next[index].elements || []
      const from = elements.findIndex((el: any) => el.id === op.elementId)
      if (from < 0) throw new Error(`element not found: ${op.elementId}`)
      const to = Math.max(0, Math.min(op.toIndex, elements.length - 1))
      const [element] = elements.splice(from, 1)
      elements.splice(to, 0, element)
      next[index] = { ...next[index], elements }
      slidesStore.setSlides(next)
      mainStore.setActiveElementIdList([op.elementId])
      return
    }
    default:
      throw new Error(`unsupported edit op: ${op.type}`)
  }
}

function isAnimatedTextEditOp(op: any) {
  return op?.type === 'element:update-text' && op.animation?.mode === 'typewriter'
}

function updateTextEditableElement(slideId: string, element: any, content: string) {
  if (element.type === 'text') {
    slidesStore.updateElement({ id: element.id, slideId, props: { content } })
    return
  }
  if (element.type === 'shape' && element.text) {
    slidesStore.updateElement({ id: element.id, slideId, props: { text: { ...element.text, content } } })
  }
}

function postFinalAnimatedEditState(slideId: string) {
  const currentSlide = slidesStore.slides.find(slide => slide.id === slideId)
  if (!currentSlide) return
  window.parent?.postMessage({
    type: 'pptist:slide-updated',
    slideId,
    slide: clone(currentSlide),
  }, '*')
  window.parent?.postMessage({ type: 'pptist:dirty-changed', dirty: true }, '*')
}

async function applyAnimatedTextEditOp(op: any) {
  if (!op.elementId) throw new Error('element:update-text requires elementId')
  if (typeof op.text !== 'string') throw new Error('element:update-text requires text')

  focusEditTarget(op)
  const index = requireSlideIndex(op)
  const slide = slidesStore.slides[index]
  const element = slide.elements?.find((el: any) => el.id === op.elementId) as any
  if (!element) throw new Error(`element not found: ${op.elementId}`)

  const sourceContent = getElementTextEditContent(element)
  if (sourceContent === null) throw new Error(`element is not text-editable: ${op.elementId}`)

  const allFrames = buildAnimatedTextEditFrames(sourceContent, op.text)
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const frames = reduceMotion
    ? [allFrames[allFrames.length - 1]]
    : op.animation?.clearFirst === false
      ? allFrames.slice(1)
      : allFrames
  if (!frames.length && allFrames.length) frames.push(allFrames[allFrames.length - 1])
  const timing = getAnimatedTextEditTiming(frames.length, {
    clearFirst: op.animation?.clearFirst !== false,
    reducedMotion: reduceMotion,
  })
  const releaseProgrammaticUpdate = beginEmbedProgrammaticUpdate()
  mainStore.setEmbedEditingState(op.elementId, op.animation?.showCaret !== false)
  try {
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
      const content = frames[frameIndex]
      updateTextEditableElement(slide.id, element, content)
      await nextTick()
      await nextAnimationFrame()
      if (!reduceMotion) {
        const delay = frameIndex === 0 && timing.clearHoldMs > 0 ? timing.clearHoldMs : timing.frameDelayMs
        await sleep(delay)
      }
    }
    if (timing.finalHoldMs > 0) await sleep(timing.finalHoldMs)
  }
  finally {
    mainStore.setEmbedEditingState('', false)
    releaseProgrammaticUpdate()
  }
  postFinalAnimatedEditState(slide.id)
}

async function applyPptistEditOps(runId: string, ops: any[]) {
  const backup = snapshotForHost()
  let applied = 0
  try {
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      embedEditStatus.value = isAnimatedTextEditOp(op)
        ? `Applying animated edit ${i + 1}/${ops.length} in PPTist...`
        : `Applying edit ${i + 1}/${ops.length} in PPTist...`
      window.parent?.postMessage({ type: 'pptist:edit-op-started', runId, index: i, op }, '*')
      ensureEmbedSlideForOp(op)
      if (isAnimatedTextEditOp(op)) await applyAnimatedTextEditOp(op)
      else applyPptistEditOp(op)
      syncEmbedFullSlidesFromCurrentStore()
      applied = i + 1
      window.parent?.postMessage({ type: 'pptist:edit-op-applied', runId, index: i, op }, '*')
      await nextTick()
      await sleep(180)
    }
    embedEditStatus.value = ''
    window.parent?.postMessage({ type: 'pptist:edit-run-completed', runId, ok: true, applied }, '*')
  }
  catch (err) {
    slidesStore.setSlides(backup.slides as any, backup.theme as any)
    if (backup.title) slidesStore.setTitle(backup.title)
    if (backup.viewportSize) slidesStore.setViewportSize(backup.viewportSize)
    if (backup.viewportRatio) slidesStore.setViewportRatio(backup.viewportRatio)
    slidesStore.updateSlideIndex(Math.max(0, Math.min(backup.slideIndex || 0, slidesStore.slides.length - 1)))
    embedEditStatus.value = ''
    window.parent?.postMessage({
      type: 'pptist:edit-run-completed',
      runId,
      ok: false,
      applied,
      error: err instanceof Error ? err.message : String(err),
    }, '*')
  }
}

// htmlTypeSteps returns the sequence of partial-HTML strings that reveal the
// visible text of `html` one character at a time while preserving all tags and
// inline styling. steps[0] has no visible text; the last step is the full html.
function htmlTypeSteps(html: string): string[] {
  const tpl = document.createElement('div')
  tpl.innerHTML = html
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(tpl, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    textNodes.push(node as Text)
    node = walker.nextNode()
  }
  const fulls = textNodes.map(t => t.data)
  const total = fulls.reduce((sum, f) => sum + f.length, 0)
  if (total === 0) return [html]
  const steps: string[] = []
  for (let revealed = 0; revealed <= total; revealed++) {
    let remaining = revealed
    for (let i = 0; i < textNodes.length; i++) {
      const take = Math.max(0, Math.min(fulls[i].length, remaining))
      textNodes[i].data = fulls[i].slice(0, take)
      remaining -= take
    }
    steps.push(tpl.innerHTML)
  }
  return steps
}

// appendOrReplaceSlide inserts a slide, replacing the initial empty placeholder
// on the first add. Shared by the immediate and animated add paths.
function appendOrReplaceSlide(slide: any, index?: number) {
  const current = slidesStore.slides
  const isInitialEmpty = current.length === 1 && current[0].elements.length === 0
  if (index !== undefined && index >= 0 && index <= current.length && !isInitialEmpty) {
    const next = [...current]
    next.splice(index, 0, slide)
    slidesStore.setSlides(next)
  }
  else if (isInitialEmpty) {
    slidesStore.setSlides([slide])
  }
  else {
    slidesStore.setSlides([...current, slide])
  }
}

function hydrateEmbedSlidesAfterFirstPaint(data: any, loadedSlides: any[], importStartedAt: number) {
  void nextTick(() => {
    window.requestAnimationFrame(() => {
      pptistImportLog('iframe:load-slides:render-frame', {
        runId: data.importRunId,
        slides: loadedSlides.length,
        hydratedSlides: embedHydratedSlideIds.size,
        totalMs: elapsedSince(importStartedAt),
      })

      requestEmbedIdle(() => {
        pptistImportLog('iframe:load-slides:hydrate-full-deck', {
          runId: data.importRunId,
          slides: loadedSlides.length,
          mode: 'lazy-per-slide',
          hydratedSlides: embedHydratedSlideIds.size,
          totalMs: elapsedSince(importStartedAt),
        })
      })
    })
  })
}

function loadSlidesIntoEmbed(data: any, loadedSlides: any[], importStartedAt: number, includeSlidesInLoadedEvent: boolean) {
  cancelEmbedAnimatedSlideQueue()
  pptistImportLog('iframe:load-slides:received', {
    runId: data.importRunId,
    slides: loadedSlides.length,
    animate: Boolean(data.animate),
    fromCache: Boolean(data.cacheKey),
  })
  pptistImportLog('iframe:slides-loaded:post', {
    runId: data.importRunId,
    slides: loadedSlides.length,
    totalMs: elapsedSince(importStartedAt),
  })
  window.parent?.postMessage({
    type: 'pptist:slides-loaded',
    importRunId: data.importRunId,
    count: loadedSlides.length,
    slides: includeSlidesInLoadedEvent ? loadedSlides : undefined,
  }, '*')
  if (data.animate) {
    embedFullSlides = null
    embedHydratedSlideIds.clear()
    animSlideQueue.splice(0)
    slidesStore.setSlides([{ id: nanoid(10), elements: [] }])
    for (const slide of loadedSlides) {
      enqueueAnimatedSlide(slide)
    }
    return
  }
  pptistImportLog('iframe:load-slides:set-slides:start', {
    runId: data.importRunId,
    slides: loadedSlides.length,
    totalMs: elapsedSince(importStartedAt),
  })
  deferEmbedEditableModeForRender()
  const releaseProgrammaticUpdate = beginEmbedProgrammaticUpdate()
  slidesStore.setSlides(buildEmbedInitialSlides(loadedSlides))
  slidesStore.updateSlideIndex(0)
  releaseProgrammaticUpdate()
  restoreEmbedEditableModeAfterRender()
  pptistImportLog('iframe:load-slides:set-slides:end', {
    runId: data.importRunId,
    slides: loadedSlides.length,
    totalMs: elapsedSince(importStartedAt),
  })
  hydrateEmbedSlidesAfterFirstPaint(data, loadedSlides, importStartedAt)
  const activeSlide = loadedSlides[0]
  if (activeSlide?.id) {
    captureSlideThumbnail(activeSlide.id)
  }
  pptistImportLog('iframe:load-slides:end', {
    runId: data.importRunId,
    slides: loadedSlides.length,
    totalMs: elapsedSince(importStartedAt),
  })
}

// Animated-slide queue: pages are typed in one at a time, character by character,
// with small randomized delays and occasional longer "thinking" pauses, so the
// embed looks like a person authoring the deck live (used for demo recordings).
const animSlideQueue: any[] = []
let animProcessing = false
let animQueueGeneration = 0

function cancelEmbedAnimatedSlideQueue() {
  animQueueGeneration++
  animSlideQueue.splice(0)
  animProcessing = false
  embedPageRendering.value = false
  _skipAnimDelay = false
}

function isEmbedAnimationActive(generation: number) {
  return generation === animQueueGeneration
}

function enqueueAnimatedSlide(slide: any) {
  animSlideQueue.push(slide)
  if (!animProcessing) void processAnimQueue(animQueueGeneration)
}

async function processAnimQueue(generation: number) {
  if (animProcessing) return
  animProcessing = true
  while (animSlideQueue.length && isEmbedAnimationActive(generation)) {
    const slide = animSlideQueue.shift()
    await addAndTypeSlide(slide, generation)
    if (!isEmbedAnimationActive(generation)) break
    await sleep(95 + Math.random() * 105) // fake pause between pages
  }
  if (isEmbedAnimationActive(generation)) {
    animProcessing = false
    _skipAnimDelay = false
  }
}

async function typeSteps(steps: string[], apply: (content: string) => void) {
  for (let i = 1; i < steps.length; i++) {
    apply(steps[i])
    let delay = 6 + Math.random() * 10
    if (Math.random() < 0.05) delay += 55 + Math.random() * 115 // occasional fake pause
    await sleep(delay)
  }
}

async function addAndTypeSlide(slide: any, generation: number) {
  if (!isEmbedAnimationActive(generation)) return
  const renderOnlySlide = { ...slide, elements: [] }
  appendOrReplaceSlide(renderOnlySlide)
  const renderIdx = slidesStore.slides.findIndex(s => s.id === slide.id)
  if (renderIdx >= 0) {
    slidesStore.updateSlideIndex(renderIdx)
    window.parent?.postMessage({ type: 'pptist:slide-changed', index: renderIdx, slideId: slide.id }, '*')
  }
  embedPageRendering.value = true
  await sleep(randomPageRenderDelayMs({ imageRich: hasRenderableImages(slide) }))
  if (!isEmbedAnimationActive(generation)) return
  embedPageRendering.value = false

  // Build a skeleton with text emptied (steps[0]); chart/image/card fills stay.
  const stepEntries: { id: string; kind: 'text' | 'shape'; steps: string[]; el: any }[] = []
  const elements = (slide.elements || []).map((el: any) => {
    if (el.type === 'text' && typeof el.content === 'string' && el.content) {
      const steps = htmlTypeSteps(el.content)
      stepEntries.push({ id: el.id, kind: 'text', steps, el })
      return { ...el, content: steps[0] }
    }
    if (el.type === 'shape' && el.text && typeof el.text.content === 'string' && el.text.content) {
      const steps = htmlTypeSteps(el.text.content)
      stepEntries.push({ id: el.id, kind: 'shape', steps, el })
      return { ...el, text: { ...el.text, content: steps[0] } }
    }
    return el
  })

  const idx = slidesStore.slides.findIndex(s => s.id === slide.id)
  if (idx >= 0) {
    const next = [...slidesStore.slides]
    next[idx] = { ...slide, elements }
    slidesStore.setSlides(next)
  }
  else {
    appendOrReplaceSlide({ ...slide, elements })
  }
  const activeIdx = slidesStore.slides.findIndex(s => s.id === slide.id)
  if (activeIdx >= 0) {
    slidesStore.updateSlideIndex(activeIdx)
  }
  await nextTick()
  if (!isEmbedAnimationActive(generation)) return

  for (const entry of stepEntries) {
    await typeSteps(entry.steps, content => {
      if (!isEmbedAnimationActive(generation)) return
      if (entry.kind === 'text') {
        slidesStore.updateElement({ id: entry.id, props: { content }, slideId: slide.id })
      }
      else {
        slidesStore.updateElement({ id: entry.id, props: { text: { ...entry.el.text, content } }, slideId: slide.id })
      }
    })
    if (!isEmbedAnimationActive(generation)) return
    await sleep(30 + Math.random() * 50) // pause between elements
  }
  if (!isEmbedAnimationActive(generation)) return
  captureSlideThumbnail(slide.id)
  // Signal completion so the host reveals this page's full content only now —
  // keeping the live typing on the right strictly ahead of the left canvas.
  if (activeIdx >= 0) {
    window.parent?.postMessage({ type: 'pptist:slide-typed', index: activeIdx, slideId: slide.id }, '*')
  }
}

function setupEmbedMode() {
  mainStore.setEmbedMode(true)
  mainStore.setEmbedEditableMode(isEmbedEditable)
  if (isEmbedEditable) mainStore.setCanvasPercentage(96)
  slidesStore.setSlides([{ id: nanoid(10), elements: [] }])
  snapshotStore.initSnapshotDatabase()

  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data
    if (!data || typeof data.type !== 'string') return

    switch (data.type) {
      case 'pptist:add-slide': {
        if (!data.slide) return
        // Animated: queue the page so it types in character-by-character.
        if (data.animate) {
          enqueueAnimatedSlide(data.slide)
          break
        }
        appendOrReplaceSlide(data.slide, data.index)
        syncEmbedFullSlidesFromCurrentStore()
        if (data.slide.id) captureSlideThumbnail(data.slide.id)
        break
      }
      case 'pptist:update-slide': {
        if (!data.slideId || !data.slide) return
        const current = slidesStore.slides
        const idx = current.findIndex(s => s.id === data.slideId)
        if (idx === -1) return
        const next = [...current]
        const baseSlide = isEmbedPlaceholderSlide(next[idx])
          ? findEmbedFullSlideById(data.slideId) || next[idx]
          : next[idx]
        next[idx] = { ...baseSlide, ...data.slide }
        slidesStore.setSlides(next)
        syncEmbedFullSlidesFromCurrentStore()
        break
      }
      case 'pptist:set-thumbnail-capture-paused': {
        thumbnailCapturePaused = Boolean(data.paused)
        if (!thumbnailCapturePaused) processThumbnailQueue()
        break
      }
      case 'pptist:set-thumbnail-capture-enabled': {
        thumbnailCaptureEnabled = Boolean(data.enabled)
        if (!thumbnailCaptureEnabled) {
          pendingThumbnailIds.clear()
          if (thumbnailRetryTimer) {
            clearTimeout(thumbnailRetryTimer)
            thumbnailRetryTimer = null
          }
          break
        }
        processThumbnailQueue()
        break
      }
      case 'pptist:load-slides': {
        if (!Array.isArray(data.slides)) return
        const importStartedAt = performance.now()
        const loadedSlides = clone(data.slides)
        loadSlidesIntoEmbed(data, loadedSlides, importStartedAt, true)
        break
      }
      case 'pptist:load-slides-cache': {
        if (!data.cacheKey) return
        const importStartedAt = performance.now()
        pptistImportLog('iframe:load-slides-cache:received', {
          runId: data.importRunId,
        })
        readParsedSlidesCache(data.cacheKey)
          .then((cachedSlides) => {
            if (!cachedSlides?.length) {
              pptistImportLog('iframe:load-slides-cache:miss', {
                runId: data.importRunId,
                totalMs: elapsedSince(importStartedAt),
              })
              window.parent?.postMessage({
                type: 'pptist:slides-cache-miss',
                importRunId: data.importRunId,
                cacheKey: data.cacheKey,
              }, '*')
              return
            }
            pptistImportLog('iframe:load-slides-cache:hit', {
              runId: data.importRunId,
              slides: cachedSlides.length,
              totalMs: elapsedSince(importStartedAt),
            })
            loadSlidesIntoEmbed(data, cachedSlides, importStartedAt, false)
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err)
            pptistImportLog('iframe:load-slides-cache:error', {
              runId: data.importRunId,
              message,
              totalMs: elapsedSince(importStartedAt),
            })
            window.parent?.postMessage({
              type: 'pptist:slides-cache-miss',
              importRunId: data.importRunId,
              cacheKey: data.cacheKey,
              error: message,
            }, '*')
          })
        break
      }
      case 'pptist:load-pptx': {
        if (!data.buffer) return
        cancelEmbedAnimatedSlideQueue()
        const importStartedAt = performance.now()
        pptistImportLog('iframe:load-pptx:received', {
          runId: data.importRunId,
          fileName: data.fileName || 'deck.pptx',
          byteLength: data.buffer.byteLength,
          animate: Boolean(data.animate),
          slideIds: Array.isArray(data.slideIds) ? data.slideIds.length : 0,
        })
        const file = new File([data.buffer], data.fileName || 'deck.pptx', {
          type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        })
        deferEmbedEditableModeForRender()
        const releaseProgrammaticUpdate = beginEmbedProgrammaticUpdate()
        importPPTXFile([file], { cover: true, skipHistorySnapshot: true, logContext: { runId: data.importRunId } }).then(() => {
          pptistImportLog('iframe:import-pptx:end', {
            runId: data.importRunId,
            fileName: file.name,
            slides: slidesStore.slides.length,
            totalMs: elapsedSince(importStartedAt),
          })
          const parsedSlides = JSON.parse(JSON.stringify(slidesStore.slides))
          const allSlides = Array.isArray(data.slideIds)
            ? parsedSlides.map((slide: any, index: number) => ({
                ...slide,
                id: typeof data.slideIds[index] === 'string' ? data.slideIds[index] : slide.id,
              }))
            : parsedSlides
          if (data.cacheKey) {
            writeParsedSlidesCache(data.cacheKey, allSlides)
              .then(() => {
                pptistImportLog('iframe:parsed-slides-cache:write-end', {
                  runId: data.importRunId,
                  slides: allSlides.length,
                })
              })
              .catch((err) => {
                pptistImportLog('iframe:parsed-slides-cache:write-error', {
                  runId: data.importRunId,
                  message: err instanceof Error ? err.message : String(err),
                })
              })
          }
          pptistImportLog('iframe:slides-loaded:post', {
            runId: data.importRunId,
            fileName: file.name,
            slides: allSlides.length,
            totalMs: elapsedSince(importStartedAt),
          })
          window.parent?.postMessage({
            type: 'pptist:slides-loaded',
            importRunId: data.importRunId,
            count: allSlides.length,
            slides: data.cacheKey ? undefined : allSlides,
          }, '*')
           if (data.animate) {
             embedFullSlides = null
             embedHydratedSlideIds.clear()
             animSlideQueue.splice(0)
             slidesStore.setSlides([{ id: nanoid(10), elements: [] }])
             for (const slide of allSlides) {
              enqueueAnimatedSlide(slide)
            }
            releaseProgrammaticUpdate()
             restoreEmbedEditableModeAfterRender()
             return
           }
           pptistImportLog('iframe:load-slides:set-slides:start', {
             runId: data.importRunId,
             slides: allSlides.length,
             totalMs: elapsedSince(importStartedAt),
           })
           slidesStore.setSlides(buildEmbedInitialSlides(allSlides))
           slidesStore.updateSlideIndex(0)
           pptistImportLog('iframe:load-slides:set-slides:end', {
             runId: data.importRunId,
             slides: allSlides.length,
             totalMs: elapsedSince(importStartedAt),
           })
           hydrateEmbedSlidesAfterFirstPaint(data, allSlides, importStartedAt)
           const activeSlide = allSlides[0]
           if (activeSlide?.id) {
             captureSlideThumbnail(activeSlide.id)
           }
           releaseProgrammaticUpdate()
           restoreEmbedEditableModeAfterRender()
        })
          .catch((err) => {
            releaseProgrammaticUpdate()
            restoreEmbedEditableModeAfterRender()
            throw err
          })
        break
      }
	      case 'pptist:goto-slide': {
        if (typeof data.index === 'number') {
          const switchStartedAt = performance.now()
          const index = Math.max(0, Math.min(data.index, slidesStore.slides.length - 1))
          const slide = ensureEmbedSlideHydrated(index)
          pptistImportLog('iframe:goto-slide:received', {
            index,
            slideId: slide?.id,
            hydratedSlides: embedHydratedSlideIds.size,
          })
          if (slide) {
            window.parent?.postMessage({ type: 'pptist:slide-changing', index, slideId: slide.id }, '*')
          }
          deferEmbedEditableModeForRender()
          const releaseProgrammaticUpdate = beginEmbedProgrammaticUpdate()
          slidesStore.updateSlideIndex(index)
          releaseProgrammaticUpdate()
          restoreEmbedEditableModeAfterRender()
          pptistImportLog('iframe:goto-slide:update-index:end', {
            index,
            slideId: slide?.id,
            totalMs: elapsedSince(switchStartedAt),
          })
          void nextTick(() => {
            window.requestAnimationFrame(() => {
              pptistImportLog('iframe:goto-slide:render-frame', {
                index,
                slideId: slide?.id,
                totalMs: elapsedSince(switchStartedAt),
               })
               if (slide) {
                 captureSlideThumbnail(slide.id)
                 window.parent?.postMessage({ type: 'pptist:slide-changed', index, slideId: slide.id }, '*')
               }
             })
          })
        }
	        break
	      }
      case 'pptist:select-elements': {
        if (!Array.isArray(data.elementIds)) return
        const switchStartedAt = performance.now()
        const rawIndex = slideIndexForOp(data)
        if (rawIndex < 0) return
        const index = Math.max(0, Math.min(rawIndex, slidesStore.slides.length - 1))
        const slide = ensureEmbedSlideHydrated(index)
        if (!slide) return
        const elementIds = data.elementIds
          .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
          .filter((id: string) => slide.elements?.some((element: any) =>
            element.id === id &&
            !element.lock &&
            !mainStore.hiddenElementIdList.includes(id),
          ))
        pptistImportLog('iframe:select-elements:received', {
          index,
          slideId: slide.id,
          elementIds: elementIds.length,
          hydratedSlides: embedHydratedSlideIds.size,
        })
        window.parent?.postMessage({ type: 'pptist:slide-changing', index, slideId: slide.id }, '*')
        deferEmbedEditableModeForRender()
        const releaseProgrammaticUpdate = beginEmbedProgrammaticUpdate()
        slidesStore.updateSlideIndex(index)
        releaseProgrammaticUpdate()
        restoreEmbedEditableModeAfterRender()
        mainStore.setEditorareaFocus(true)
        mainStore.updateSelectedSlidesIndex([])
        mainStore.setActiveElementIdList(elementIds)
        void nextTick(() => {
          window.requestAnimationFrame(() => {
            pptistImportLog('iframe:select-elements:render-frame', {
              index,
              slideId: slide.id,
              elementIds: elementIds.length,
              totalMs: elapsedSince(switchStartedAt),
            })
            captureSlideThumbnail(slide.id)
            window.parent?.postMessage({ type: 'pptist:slide-changed', index, slideId: slide.id }, '*')
            postSelectionForHost()
          })
        })
        break
      }
	      case 'pptist:get-snapshot': {
	        window.parent?.postMessage({
	          type: 'pptist:snapshot-result',
	          requestId: data.requestId,
	          snapshot: snapshotForHost(),
	        }, '*')
	        break
	      }
	      case 'pptist:apply-edit-ops': {
	        if (!data.runId || !Array.isArray(data.ops)) return
	        void applyPptistEditOps(data.runId, data.ops)
	        break
	      }
      case 'pptist:export-pptx': {
         // PPTX export is owned by the OfficeDex host editor. Keep this message
         // for protocol compatibility so older hosts receive a clear error.
         const exportFileName = data.fileName || 'deck.pptx'
	        exportPPTX(getEmbedEffectiveSlides(), false, false, (buffer: ArrayBuffer) => {
	          window.parent?.postMessage(
	            { type: 'pptist:export-result', requestId: data.requestId, buffer, fileName: exportFileName, targetFilePath: data.targetFilePath },
	            '*',
	            [buffer],
	          )
	        }, (err: unknown) => {
	          window.parent?.postMessage({
	            type: 'pptist:export-error',
	            requestId: data.requestId,
	            error: err instanceof Error ? err.message : String(err),
	            fileName: exportFileName,
	            targetFilePath: data.targetFilePath,
	          }, '*')
        })
        break
      }
        case 'pptist:clear': {
          cancelEmbedAnimatedSlideQueue()
          embedFullSlides = null
          embedHydratedSlideIds.clear()
          slidesStore.setSlides([{ id: nanoid(10), elements: [] }])
         break
       }
    }
  })

  window.parent?.postMessage({ type: 'pptist:embed-ready' }, '*')
  watchEmbedSlideIndexForHydration()

  // Notify parent when user edits a slide
  let editNotifyTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    () => {
      const currentSlide = slidesStore.currentSlide
      return currentSlide
        ? {
            slideId: currentSlide.id,
            signature: JSON.stringify({
              elements: currentSlide.elements,
              background: currentSlide.background,
            }),
          }
        : { slideId: '', signature: '' }
    },
    (current, previous) => {
      if (isEmbedProgrammaticUpdate()) return
      if (!previous || current.slideId !== previous.slideId) return
      if (current.signature === previous.signature) return
      window.parent?.postMessage({ type: 'pptist:dirty-changed', dirty: true }, '*')
      if (editNotifyTimer) clearTimeout(editNotifyTimer)
      editNotifyTimer = setTimeout(() => {
        const currentSlide = slidesStore.slides[slidesStore.slideIndex]
        if (currentSlide) {
	          window.parent?.postMessage({
	            type: 'pptist:slide-updated',
	            slideId: currentSlide.id,
	            slide: JSON.parse(JSON.stringify(currentSlide)),
	          }, '*')
	        }
	      }, 500)
    },
  )
}

onMounted(async () => {
  const initialPerformanceConfig = getPptxPerformanceConfig({
    search: window.location.search,
  })
  mainStore.setPptxPerformanceMode(initialPerformanceConfig.enabled)
  if (initialPerformanceConfig.maxCanvasPercentage !== null && mainStore.canvasPercentage > initialPerformanceConfig.maxCanvasPercentage) {
    mainStore.setCanvasPercentage(initialPerformanceConfig.maxCanvasPercentage)
    mainStore.setCanvasDragged(false)
  }

  if (isSlidePreview) {
    snapshotStore.initSnapshotDatabase()
    return
  }
  if (isEmbedMode) {
    setupEmbedMode()
  }
  else if (isEmbedPreview) {
    setupEmbedPreview()
  }
  else if (isAudienceMode) {
    slidesStore.setSlides([{
      id: nanoid(10),
      elements: [],
    }])
    screenStore.setScreening(true)
  }
  else {
    const slides = await api.getMockData('slides')
    slidesStore.setSlides(slides)

    await deleteDiscardedDB()
    snapshotStore.initSnapshotDatabase()
  }
})

// 应用注销时向 localStorage 中记录下本次 indexedDB 的数据库ID，用于之后清除数据库
window.addEventListener('beforeunload', () => {
  const discardedDB = localStorage.getItem(LOCALSTORAGE_KEY_DISCARDED_DB)
  const discardedDBList: string[] = discardedDB ? JSON.parse(discardedDB) : []

  discardedDBList.push(databaseId.value)

  const newDiscardedDB = JSON.stringify(discardedDBList)
  localStorage.setItem(LOCALSTORAGE_KEY_DISCARDED_DB, newDiscardedDB)
})
</script>

<style lang="scss">
#app {
  height: 100%;
}

.embed-edit-status {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 9000;
  max-width: 320px;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(24, 32, 48, 0.92);
  color: #fff;
  font-size: 13px;
  line-height: 1.45;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
  pointer-events: none;
}
</style>

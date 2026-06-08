<template>
  <div class="video-dialog-box">
    <t-dialog
      v-model:visible="dialogVisible"
      :width="dialogWidth"
      class="video-preview-dialog"
      placement="center"
      :header="false"
      :footer="false"
      destroy-on-close
      @close="onClose"
    >
      <div class="video-box" :style="videoBoxStyle">
        <video
          v-if="props.videoUrl"
          :key="props.videoUrl"
          ref="videoPlayer"
          class="video-look"
          autoplay
          :src="localUrl.addFileProtocol(props.videoUrl)"
          controls
          @loadedmetadata="onLoadedMetadata"
        />
      </div>
    </t-dialog>
  </div>
</template>
<script setup>
import { ref, computed, watch } from 'vue'
import { localUrl } from '@renderer/utils'

const emit = defineEmits(['cancel', 'update:showVideoDialog'])
const props = defineProps({
  showVideoDialog: Boolean,
  videoUrl: String
})

const videoPlayer = ref(null)
const dialogWidth = ref(400)
const videoBoxStyle = ref({
  width: '352px',
  height: '198px'
})

const dialogVisible = computed({
  get: () => props.showVideoDialog,
  set: (val) => {
    if (!val) {
      onClose()
    }
  }
})

/** 按视频比例适配弹窗，限制在视口内 */
function fitVideoBox(videoWidth, videoHeight) {
  const ratio = videoWidth / videoHeight
  const maxContentW = Math.min(window.innerWidth * 0.88, 1080) - 32
  const maxContentH = window.innerHeight * 0.78 - 48

  let w = maxContentW
  let h = w / ratio
  if (h > maxContentH) {
    h = maxContentH
    w = h * ratio
  }

  return {
    w: Math.max(Math.round(w), 240),
    h: Math.max(Math.round(h), 135)
  }
}

function applyLayout(videoWidth, videoHeight) {
  const { w, h } = fitVideoBox(videoWidth, videoHeight)
  videoBoxStyle.value = {
    width: `${w}px`,
    height: `${h}px`
  }
  dialogWidth.value = w + 32
}

function resetLayout() {
  dialogWidth.value = 400
  videoBoxStyle.value = {
    width: '352px',
    height: '198px'
  }
}

function onLoadedMetadata() {
  const el = videoPlayer.value
  if (!el?.videoWidth || !el?.videoHeight) {
    return
  }
  applyLayout(el.videoWidth, el.videoHeight)
}

function onClose() {
  videoPlayer.value?.pause()
  resetLayout()
  emit('cancel')
  emit('update:showVideoDialog', false)
}

watch(
  () => props.showVideoDialog,
  (show) => {
    if (show) {
      resetLayout()
    }
  }
)
</script>
<style lang="less" scoped>
.video-dialog-box {
  :deep(.video-preview-dialog) {
    .t-dialog {
      border-radius: 8px;
      overflow: hidden;
    }

    .t-dialog__body {
      padding: 16px;
    }

    .t-dialog__close {
      z-index: 2;
    }
  }
}

.video-box {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 0 auto;
  background: #161718;
  border-radius: 6px;
  overflow: hidden;

  .video-look {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    background: #000;
  }
}
</style>

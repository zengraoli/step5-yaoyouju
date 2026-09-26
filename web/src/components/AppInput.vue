<script setup lang="ts">
/** 输入框（带标签；占位与弱提示用 text-3） */
withDefaults(
  defineProps<{
    modelValue: string
    label?: string
    placeholder?: string
    type?: 'text' | 'number' | 'password'
    maxlength?: number
  }>(),
  { label: '', placeholder: '', type: 'text', maxlength: 50 },
)

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
</script>

<template>
  <label class="app-input">
    <span v-if="label" class="app-input__label">{{ label }}</span>
    <input
      class="app-input__control"
      :class="{ 'app-input__control--labeled': label }"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :maxlength="maxlength"
      @input="onInput"
    />
  </label>
</template>

<style scoped>
.app-input {
  display: block;
}

.app-input__label {
  display: block;
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
  margin-bottom: var(--spacing-xs);
}

.app-input__control {
  width: 100%;
  min-height: 44px;
  padding: 10px var(--spacing-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-size: var(--font-size-body);
  font-family: inherit;
  color: var(--color-text-1);
  transition: border-color 0.15s;
}

.app-input__control::placeholder {
  color: var(--color-text-3);
}

.app-input__control:focus {
  outline: none;
  border-color: var(--color-primary);
}
</style>

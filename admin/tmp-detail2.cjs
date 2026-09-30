const fs=require('fs');
const p='src/views/contents/ContentDetailView.vue';
const raw=fs.readFileSync(p,'utf8');
const had=raw.includes('\r\n');
let s=raw.replace(/\r\n/g,'\n');
const Q = String.fromCharCode(39);
const BT = String.fromCharCode(96);
const NL = String.fromCharCode(10);

// 1) 类型行
const oldType = '<input class="form-field__input" type="text" :value="' + BT + '${detail.type}（示意动画 · 2:55）' + BT + '" readonly />';
const newType = '<input class="form-field__input" type="text" :value="typeWithDuration" readonly />';
if(!s.includes(oldType)) throw new Error('type');
s=s.replace(oldType,newType);

// 2) 字幕文件
const oldSub = '<input class="form-field__input" type="text" value="subtitles_v2.srt · 已上传 · 与脚本一致性检查通过" readonly />';
const newSub = '<input class="form-field__input" type="text" :value="subtitleFileText" readonly />';
if(!s.includes(oldSub)) throw new Error('sub');
s=s.replace(oldSub,newSub);

// 3) 素材版本
const oldAsset1 = '<input class="form-field__input" type="text" value="v2 · 受控 3D 白模渲染 · 未使用生成模型重绘 · 素材版本 M3D-0.4" readonly />';
const newAsset1 = '<input class="form-field__input" type="text" :value="' + BT + 'v${detail.current_version?.version ?? 1} · 受控制作 · 未使用生成模型重绘' + BT + '" readonly />';
if(!s.includes(oldAsset1)) throw new Error('asset1');
s=s.replace(oldAsset1,newAsset1);

// 4) 资源文件
const oldAsset2 = '<input class="form-field__input" type="text" value="activity_v2.mp4 · 480p/720p · 上传 2026-09-19" readonly />';
const newAsset2 = '<input class="form-field__input" type="text" :value="assetFileText" readonly />';
if(!s.includes(oldAsset2)) throw new Error('asset2');
s=s.replace(oldAsset2,newAsset2);

// 5) 依据列表整体替换
const evStart = s.indexOf('          <ul class="evidence-list">');
const evEnd = s.indexOf('          </ul>', evStart);
if (evStart < 0 || evEnd < 0) throw new Error('evidence list');
const evidenceTpl = [
'          <ul class="evidence-list">',
'            <li v-for="ev in evidences" :key="ev.id" class="evidence-item">',
'              <span class="evidence-item__id">{{ ev.code }} {{ ev.source_type }}</span>',
'              <span class="evidence-item__desc">{{ ev.title }} · 许可：{{ ev.license ?? ' + Q + '待确认' + Q + ' }}</span>',
'              <StatusTag :status="ev.license === ' + Q + '可引用' + Q + ' ? ' + Q + 'confirmed' + Q + ' : ' + Q + 'unconfirmed' + Q + '" :text="ev.license === ' + Q + '可引用' + Q + ' ? ' + Q + '可用' + Q + ' : ' + Q + '待确认' + Q + '" />',
'            </li>',
'            <li v-if="evidences.length === 0" class="evidence-item">',
'              <span class="evidence-item__desc">尚未关联证据条目</span>',
'            </li>',
'',
].join(NL);
s = s.slice(0, evStart) + evidenceTpl + s.slice(evEnd);

// 6) 派生数据
const anchor = '/** 脚本差异 */';
if(!s.includes(anchor)) throw new Error('anchor');
const derived = [
'/** 类型 + 时长（时长由字幕长度推导，不写死） */',
'const typeWithDuration = computed<string>(() => {',
'  const d = detail.value',
"  const sub = d?.current_version?.subtitle_text ?? ''",
"  const chars = sub.replace(/\\s+/g, '').length",
"  if (!chars) return d?.type ?? '—'",
'  const seconds = Math.max(30, Math.round(chars / 4))',
"  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')",
'  const ss = String(seconds % 60).padStart(2, ' + Q + '0' + Q + ')',
'  return ' + BT + '${d?.type} · 时长约 ${mm}:${ss}（按字幕长度估算）' + BT,
'})',
'',
'/** 字幕文件说明（按当前版本号与替代文字长度） */',
'const subtitleFileText = computed<string>(() => {',
'  const v = detail.value?.current_version',
"  if (!v) return '尚无已发布版本'",
"  const len = (v.subtitle_text ?? '').replace(/\\s+/g, '').length",
'  return ' + BT + 'subtitles_v${v.version}.srt · 文字替代 ${len} 字 · 与脚本一致性由编辑核对' + BT,
'})',
'',
'/** 资源文件（本地占位资源，不引用外部 CDN） */',
'const assetFileText = computed<string>(() => {',
'  const v = detail.value?.current_version',
"  if (!v) return '尚无已发布版本'",
"  const key = v.asset_key ? String(v.asset_key).split('/').pop() : '本地占位资源'",
'  return ' + BT + '${key} · 480p/720p · 上传 ${(v.published_at ?? ' + Q + Q + ').slice(0, 10) || ' + Q + '—' + Q + '}' + BT,
'})',
'',
'/** 关联证据条目（真实证据库；许可「待确认」不参与检索） */',
'const evidences = ref<{ id: string; code: string; title: string; source_type: string; license: string | null; verified_at: string | null }[]>([])',
'',
'async function loadEvidences() {',
'  try {',
'    const docs = await request<{ id: string; title: string; source_type: string; license: string | null; verified_at: string | null }[]>({ url: ' + Q + '/admin/evidence' + Q + ' })',
'    evidences.value = docs.slice(0, 5).map((d, i) => ({',
'      id: d.id,',
'      code: ' + Q + 'E-' + Q + ' + String(i + 1).padStart(2, ' + Q + '0' + Q + '),',
'      title: d.title,',
'      source_type: d.source_type,',
'      license: d.license,',
'      verified_at: d.verified_at,',
'    }))',
'  } catch {',
'    evidences.value = []',
'  }',
'}',
'',
].join(NL);
s=s.replace(anchor, derived + anchor);
if(!s.includes('loadEvidences()')) {
  s=s.replace('onMounted(async () => {', 'onMounted(async () => {\n  void loadEvidences()');
}
fs.writeFileSync(p, had? s.replace(/\n/g,'\r\n') : s);
console.log('ok');

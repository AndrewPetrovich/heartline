(() => {
  'use strict';

  const te = new TextEncoder();
  const td = new TextDecoder('utf-8', { fatal: false });

  function readU16(v, o) { return v.getUint16(o, true); }
  function readU32(v, o) { return v.getUint32(o, true); }

  class MiniZip {
    constructor(buffer) {
      this.buffer = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      this.bytes = new Uint8Array(this.buffer);
      this.view = new DataView(this.buffer);
      this.entries = this._readDirectory();
    }

    _readDirectory() {
      const v = this.view;
      const b = this.bytes;
      let eocd = -1;
      const min = Math.max(0, b.length - 65557);
      for (let i = b.length - 22; i >= min; i--) {
        if (readU32(v, i) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error('ZIP: не найден центральный каталог');
      const total = readU16(v, eocd + 10);
      let ptr = readU32(v, eocd + 16);
      const entries = [];
      for (let n = 0; n < total; n++) {
        if (readU32(v, ptr) !== 0x02014b50) throw new Error('ZIP: повреждён центральный каталог');
        const flags = readU16(v, ptr + 8);
        const method = readU16(v, ptr + 10);
        const compressedSize = readU32(v, ptr + 20);
        const uncompressedSize = readU32(v, ptr + 24);
        const fileNameLength = readU16(v, ptr + 28);
        const extraLength = readU16(v, ptr + 30);
        const commentLength = readU16(v, ptr + 32);
        const localOffset = readU32(v, ptr + 42);
        const nameBytes = b.slice(ptr + 46, ptr + 46 + fileNameLength);
        let name = td.decode(nameBytes);
        if (!(flags & 0x0800)) {
          // Even when legacy encoding is used, ASCII path pieces such as word/document.xml
          // and .docx remain decodable. Replacement characters in display names are harmless.
          name = td.decode(nameBytes);
        }
        entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
        ptr += 46 + fileNameLength + extraLength + commentLength;
      }
      return entries;
    }

    list() { return this.entries.slice(); }

    async read(entryOrName) {
      const entry = typeof entryOrName === 'string'
        ? this.entries.find(e => e.name === entryOrName)
        : entryOrName;
      if (!entry) throw new Error(`ZIP: файл не найден: ${entryOrName}`);
      const v = this.view;
      const b = this.bytes;
      const off = entry.localOffset;
      if (readU32(v, off) !== 0x04034b50) throw new Error('ZIP: повреждён локальный заголовок');
      const nameLen = readU16(v, off + 26);
      const extraLen = readU16(v, off + 28);
      const dataStart = off + 30 + nameLen + extraLen;
      const compressed = b.slice(dataStart, dataStart + entry.compressedSize);
      if (entry.method === 0) return compressed;
      if (entry.method === 8) return await inflateRaw(compressed);
      throw new Error(`ZIP: метод сжатия ${entry.method} пока не поддерживается`);
    }
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Браузер не поддерживает распаковку DOCX. Откройте сервис в актуальном Safari/Chrome/Edge.');
    }
    let stream;
    try { stream = new DecompressionStream('deflate-raw'); }
    catch (_) { stream = new DecompressionStream('deflate'); }
    const input = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(input).arrayBuffer());
  }

  function localName(el) { return (el && (el.localName || el.nodeName.split(':').pop())) || ''; }
  function attr(el, name) {
    if (!el) return null;
    for (const a of Array.from(el.attributes || [])) {
      if (a.localName === name || a.name === name || a.name.endsWith(':' + name)) return a.value;
    }
    return null;
  }
  function descendants(el, name) {
    return Array.from(el.getElementsByTagNameNS('*', name));
  }
  function paragraphText(p) {
    let out = '';
    function walk(node) {
      if (node.nodeType !== 1) return;
      const ln = localName(node);
      if (ln === 't') { out += node.textContent || ''; return; }
      if (ln === 'tab') { out += '\t'; return; }
      if (ln === 'br' || ln === 'cr') { out += '\n'; return; }
      for (const ch of Array.from(node.childNodes)) walk(ch);
    }
    walk(p);
    return out.replace(/\u00a0/g, ' ').trim();
  }

  function parseXml(bytes, label) {
    const xml = td.decode(bytes);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const pe = doc.querySelector('parsererror');
    if (pe) throw new Error(`DOCX: не удалось разобрать ${label}`);
    return doc;
  }

  async function parseDocxBytes(bytes, sourceName) {
    const zip = new MiniZip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const styleEntry = zip.list().find(e => e.name === 'word/styles.xml');
    const docEntry = zip.list().find(e => e.name === 'word/document.xml');
    if (!docEntry) throw new Error(`${sourceName}: внутри DOCX нет word/document.xml`);

    const styles = new Map();
    if (styleEntry) {
      const styleDoc = parseXml(await zip.read(styleEntry), 'styles.xml');
      for (const st of Array.from(styleDoc.getElementsByTagNameNS('*', 'style'))) {
        const id = attr(st, 'styleId');
        const nameEl = descendants(st, 'name')[0];
        if (id && nameEl) styles.set(id, attr(nameEl, 'val') || id);
      }
    }

    const doc = parseXml(await zip.read(docEntry), 'document.xml');
    const paragraphs = [];
    let excluded = 0;
    for (const p of Array.from(doc.getElementsByTagNameNS('*', 'p'))) {
      const text = paragraphText(p);
      if (!text) continue;
      const pStyle = descendants(p, 'pStyle')[0];
      const styleId = pStyle ? attr(pStyle, 'val') : '';
      const styleName = styles.get(styleId) || styleId || 'Normal';
      if (styleName.startsWith('НЕ ЭКСПОРТИРОВАТЬ')) {
        excluded++;
        continue;
      }
      paragraphs.push({ style: styleName, text, source: sourceName });
    }
    return { paragraphs, excluded };
  }

  function parseTech(text) {
    const m = text.match(/^([A-ZА-ЯЁ_]+):\s*(.*)$/u);
    return m
      ? { type: 'tech', command: m[1].trim(), value: m[2].trim(), text }
      : { type: 'tech', command: 'RAW', value: text, text };
  }

  function splitIdLabel(value) {
    const pos = value.indexOf('—');
    if (pos >= 0) return [value.slice(0, pos).trim(), value.slice(pos + 1).trim()];
    return [value.trim(), value.trim()];
  }

  function compileParagraphs(paragraphs, titleHint, report) {
    const scenes = [];
    let current = null;
    for (const p of paragraphs) {
      const style = p.style || '';
      const text = p.text.trim();
      if (!text) continue;
      if (style === 'Heading 1' || /^\[[A-Z0-9_]+\]\s*/.test(text)) {
        const m = text.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (m) {
          current = { id: m[1].trim(), title: m[2].trim() || m[1].trim(), source: p.source, raw: [] };
          scenes.push(current);
          continue;
        }
      }
      if (!current) continue;
      if (style === 'Scenario Dialogue') {
        const m = text.match(/^(.+?)\s{2,}(.+)$/s);
        current.raw.push(m
          ? { type: 'dialogue', speaker: m[1].trim(), text: m[2].trim(), style }
          : { type: 'dialogue', speaker: '', text, style });
      } else if (style === 'Scenario Thought') {
        current.raw.push({ type: 'thought', text, style });
      } else if (style === 'Scenario Narration') {
        current.raw.push({ type: 'narration', text, style });
      } else if (style === 'Scenario Tech') {
        current.raw.push({ ...parseTech(text), style });
      } else {
        current.raw.push({ type: 'narration', text, style });
      }
    }

    let choiceCount = 0;
    for (const scene of scenes) {
      const raw = scene.raw;
      delete scene.raw;
      const steps = [];
      let i = 0;
      while (i < raw.length) {
        const item = raw[i];
        if (item.type === 'tech' && item.command === 'CHOICE') {
          choiceCount++;
          const [choiceId, prompt] = splitIdLabel(item.value);
          const markers = [];
          for (let j = i + 1; j < raw.length; j++) {
            if (raw[j].type === 'tech' && raw[j].command === 'OPTION') markers.push(j);
          }
          const options = markers.map((start, idx) => {
            const end = idx + 1 < markers.length ? markers[idx + 1] : raw.length;
            const [id, labelRaw] = splitIdLabel(raw[start].value);
            const label = labelRaw.replace(/^«|»$/g, '');
            const branch = raw.slice(start + 1, end);
            let goto = null;
            for (const b of branch) if (b.type === 'tech' && b.command === 'GOTO') goto = b.value;
            return { id, label, steps: branch, goto };
          });
          const fallback = [...options].reverse().find(o => o.goto)?.goto || null;
          for (const o of options) if (!o.goto && fallback) o.fallbackGoto = fallback;
          steps.push({ type: 'choice', id: choiceId, prompt, options });
          // In the HEARTLINE format every choice owns the rest of the scene; each branch
          // either has its own GOTO or inherits the last branch's terminal GOTO.
          i = raw.length;
        } else {
          steps.push(item);
          i++;
        }
      }
      scene.steps = steps;
    }

    const safeTitle = cleanTitleHint(titleHint) || scenes[0]?.title || 'Импортированная новелла';
    const id = `novel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    report.scenes = scenes.length;
    report.choices = choiceCount;
    return {
      schemaVersion: 1,
      id,
      title: safeTitle,
      subtitle: 'Импортировано в HEARTLINE Novel Player',
      startScene: scenes[0]?.id || '',
      sourceFiles: [...new Set(paragraphs.map(p => p.source))],
      excludedParagraphs: report.excluded,
      scenes
    };
  }

  function cleanTitleHint(name) {
    return String(name || '')
      .replace(/\.(zip|docx|json)$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) throw new Error('Файлы не выбраны');
    const report = { files: [], excluded: 0, paragraphs: 0, scenes: 0, choices: 0 };
    const paragraphs = [];
    let titleHint = files.length === 1 ? files[0].name : files[0].name;

    for (const file of files) {
      const lower = file.name.toLowerCase();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (lower.endsWith('.docx')) {
        const r = await parseDocxBytes(bytes, file.name);
        paragraphs.push(...r.paragraphs);
        report.excluded += r.excluded;
        report.files.push(file.name);
      } else if (lower.endsWith('.zip')) {
        const outer = new MiniZip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const entries = outer.list().filter(e => e.name.toLowerCase().endsWith('.docx'));
        if (!entries.length) throw new Error(`${file.name}: DOCX-файлы внутри архива не найдены`);
        let n = 0;
        for (const entry of entries) {
          n++;
          const inner = await outer.read(entry);
          const source = entry.name || `${file.name} / ${n}.docx`;
          const r = await parseDocxBytes(inner, source);
          paragraphs.push(...r.paragraphs);
          report.excluded += r.excluded;
          report.files.push(source);
        }
      } else {
        throw new Error(`Неподдерживаемый файл: ${file.name}`);
      }
    }
    report.paragraphs = paragraphs.length;
    const novel = compileParagraphs(paragraphs, titleHint, report);
    if (!novel.scenes.length) throw new Error('После фильтрации не найдено ни одной сцены вида [SCENE_ID] Название');
    return { novel, report };
  }

  function validateNovel(novel) {
    if (!novel || !Array.isArray(novel.scenes) || !novel.scenes.length) throw new Error('JSON не похож на HEARTLINE-новеллу');
    if (!novel.id) novel.id = `novel-${Date.now().toString(36)}`;
    if (!novel.title) novel.title = 'Импортированная новелла';
    if (!novel.startScene) novel.startScene = novel.scenes[0].id;
    return novel;
  }

  window.HEARTLINEParser = { importFiles, validateNovel, MiniZip };
})();

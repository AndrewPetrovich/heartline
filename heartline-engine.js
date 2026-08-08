import { clone, now } from './heartline-domain.js';

export function createSession(projectId, versionId, content) {
  return {
    sessionId: `session:${projectId}:${versionId}`,
    projectId,
    versionId,
    createdAt: now(),
    updatedAt: now(),
    sceneId: content.startScene || content.scenes?.[0]?.id || '',
    ip: 0,
    branch: null,
    pendingChoice: null,
    vars: { HONESTY: 0, ATTRACTION: 0, TRUST: 0, PROFESSIONAL_COST: 0, ...(content.initialVars || {}) },
    tech: { bg: '', cg: '', music: '', sfx: '', sprite: '', reaction: '', fade: '' },
    choices: [],
    timeline: [],
    viewIndex: -1,
    ended: false
  };
}

export class StoryEngine {
  constructor(content, session) {
    this.content = content;
    this.session = session;
  }

  currentEntry() { return this.session.timeline[this.session.viewIndex] || null; }
  canBack() { return this.session.viewIndex > 0; }
  canForwardHistory() { return this.session.viewIndex < this.session.timeline.length - 1; }
  snapshot() {
    const s = this.session;
    return clone({ sceneId: s.sceneId, ip: s.ip, branch: s.branch, pendingChoice: s.pendingChoice, vars: s.vars, tech: s.tech, choices: s.choices, ended: s.ended });
  }
  restore(snapshot) { Object.assign(this.session, clone(snapshot)); }
  scene(id = this.session.sceneId) { return this.content.scenes.find(scene => scene.id === id) || null; }
  currentSequence() {
    if (!this.session.branch) {
      const scene = this.scene();
      return scene ? { kind: 'scene', steps: scene.steps || [], ip: this.session.ip } : null;
    }
    const scene = this.scene();
    const choice = scene?.steps?.find(step => step.type === 'choice' && step.id === this.session.branch.choiceId);
    const option = choice?.options?.find(item => item.id === this.session.branch.optionId);
    return option ? { kind: 'branch', steps: option.steps || [], ip: this.session.branch.ip, option } : null;
  }
  setSequenceIp(kind, value) { if (kind === 'branch') this.session.branch.ip = value; else this.session.ip = value; }
  variable(name) { return this.session.vars[name]; }
  setVariable(name, value) { this.session.vars[name] = value; }
  boolVariable(name) { const value = this.variable(name); return value === true || value === 'TRUE' || value === 1; }

  evaluateCondition(expression) {
    const source = String(expression || '').trim().replace(/[.;]+$/, '');
    if (!source) return true;

    // Keep the compact legacy IN syntax used by older HEARTLINE projects.
    const inMatch = source.match(/^([A-Z0-9_]+)\s+IN\s+(.+)$/i);
    if (inMatch) {
      const values = inMatch[2].split(',').map(value => value.trim().replace(/^["']|["']$/g, '').toUpperCase()).filter(Boolean);
      return values.includes(String(this.variable(inMatch[1]) ?? '').toUpperCase());
    }

    const tokenPattern = /\s*(>=|<=|!=|==|&&|\|\||=|>|<|!|\(|\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_-]*)/gy;
    const tokens = [];
    let index = 0;
    while (index < source.length) {
      tokenPattern.lastIndex = index;
      const match = tokenPattern.exec(source);
      if (!match || match.index !== index) return true; // unknown editorial syntax: never hide content by accident
      tokens.push(match[1]);
      index = tokenPattern.lastIndex;
    }
    let cursor = 0;
    const peek = () => tokens[cursor];
    const take = value => { if (tokens[cursor] === value) { cursor++; return true; } return false; };
    const asValue = (token, resolveIdentifier = true) => {
      if (token == null) return '';
      if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
      if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) return token.slice(1, -1);
      if (/^TRUE$/i.test(token)) return true;
      if (/^FALSE$/i.test(token)) return false;
      return resolveIdentifier ? this.variable(token) : token;
    };
    const truthy = value => value === true || value === 1 || value === '1' || String(value ?? '').toUpperCase() === 'TRUE' || (!!value && String(value).toUpperCase() !== 'FALSE');
    const compare = (left, op, right) => {
      if (['>','<','>=','<='].includes(op)) {
        const a = Number(left || 0), b = Number(right || 0);
        return op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b;
      }
      const numeric = Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && left !== '' && right !== '';
      const a = numeric ? Number(left) : String(left ?? '').toUpperCase();
      const b = numeric ? Number(right) : String(right ?? '').toUpperCase();
      return op === '!=' ? a !== b : a === b;
    };
    const parsePrimary = () => {
      if (take('(')) { const value = parseOr(); take(')'); return value; }
      const token = tokens[cursor++];
      const left = asValue(token, true);
      const op = peek();
      if (['=','==','!=','>','<','>=','<='].includes(op)) {
        cursor++;
        return compare(left, op, asValue(tokens[cursor++], false));
      }
      return truthy(left);
    };
    const parseUnary = () => take('!') ? !parseUnary() : parsePrimary();
    const parseAnd = () => { let value = parseUnary(); while (take('&&')) value = Boolean(value && parseUnary()); return value; };
    const parseOr = () => { let value = parseAnd(); while (take('||')) value = Boolean(value || parseAnd()); return value; };
    try { return Boolean(parseOr()); } catch (_) { return true; }
  }
  computeIfScope(steps, index) {
    const hardCommands = new Set(['BG', 'MUSIC', 'SFX', 'SPRITE', 'CG', 'FADE', 'GOTO', 'CHOICE', 'SYSTEM', 'REACTION']);
    let hardEnd = steps.length;
    let nextIf = -1;
    for (let i = index + 1; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'tech' && step.command === 'IF') { nextIf = i; break; }
      if (step.type === 'tech' && hardCommands.has(step.command)) { hardEnd = i; break; }
    }
    if (nextIf >= 0) return Math.max(0, nextIf - index - 1);
    let previousHard = -1;
    let previousIf = -1;
    for (let i = index - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.type === 'tech' && hardCommands.has(step.command)) { previousHard = i; break; }
      if (step.type === 'tech' && step.command === 'IF') { previousIf = i; break; }
    }
    if (previousIf > previousHard) {
      const length = index - previousIf - 1;
      return Math.min(length, Math.max(0, hardEnd - index - 1));
    }
    let cursor = index + 1;
    while (cursor < steps.length && steps[cursor].type === 'tech' && (steps[cursor].command === 'SET' || steps[cursor].command === 'CLEAR')) cursor++;
    if (cursor > index + 1) return cursor - index - 1;
    return Math.max(0, hardEnd - index - 1);
  }

  applySet(value) {
    const source = String(value || '').trim().replace(/[.;]+$/, '');
    let match = source.match(/^([A-Z0-9_]+)\s*([+-]\d+)$/i);
    if (match) { this.setVariable(match[1], Number(this.variable(match[1]) || 0) + Number(match[2])); return; }
    match = source.match(/^([A-Z0-9_]+)\s*=\s*(TRUE|FALSE)$/i);
    if (match) { this.setVariable(match[1], match[2].toUpperCase() === 'TRUE'); return; }
    match = source.match(/^([A-Z0-9_]+)\s*=\s*([A-Z0-9_]+)$/i);
    if (match) this.setVariable(match[1], match[2]);
  }
  applyClear(value) {
    for (const part of String(value || '').split(';')) {
      const key = part.trim().replace(/[.;]+$/, '');
      if (key) this.setVariable(key, false);
    }
  }
  evaluateRoute() {
    const scores = [
      ['ROUTE_EQUAL', Number(this.variable('HONESTY') || 0)],
      ['ROUTE_FIRE', Number(this.variable('ATTRACTION') || 0)],
      ['ROUTE_MASK', Number(this.variable('TRUST') || 0)]
    ].sort((left, right) => right[1] - left[1]);
    if (scores[0][1] - scores[1][1] >= 2 && scores.filter(item => item[1] === scores[0][1]).length === 1) {
      this.setVariable('ROUTE_ID', scores[0][0]);
      this.setVariable('DIRECT_ROUTE_CHOICE', false);
    } else {
      this.setVariable('ROUTE_ID', '');
      this.setVariable('DIRECT_ROUTE_CHOICE', true);
    }
  }
  executeSystem(value) {
    const source = String(value || '').trim();
    if (/^Сравнить\s+HONESTY/i.test(source)) { this.evaluateRoute(); return; }
    if (/^FLAG_[A-Z0-9_]+\s*=/i.test(source)) for (const part of source.split(';')) this.applySet(part.trim());
    if (/^END\s+ROUTE_/i.test(source)) {
      this.session.ended = true;
      const route = (source.match(/ROUTE_[A-Z]+/i) || [''])[0].replace('ROUTE_', '');
      this.pushEnd(`Конец маршрута ${route}.`);
    }
  }
  resolveGoto(raw) {
    const target = String(raw || '').trim().replace(/[.;]+$/, '');
    if (/соответствующая маршрутная сцена/i.test(target)) {
      if (this.boolVariable('FLAG_PACT_EQUAL')) return 'CH03_SC03_EQUAL';
      if (this.boolVariable('FLAG_PACT_FIRE')) return 'CH03_SC03_FIRE';
      if (this.boolVariable('FLAG_PACT_MASK')) return 'CH03_SC03_MASK';
      return 'CH03_SC03_EQUAL';
    }
    if (/согласно ROUTE_ID/i.test(target)) {
      const route = this.variable('ROUTE_ID');
      if (route === 'ROUTE_EQUAL') return 'CH06_SC05_EQUAL';
      if (route === 'ROUTE_FIRE') return 'CH06_SC05_FIRE';
      if (route === 'ROUTE_MASK') return 'CH06_SC05_MASK';
      return 'CH06_SC04_DIRECT';
    }
    return target;
  }
  jumpTo(target) {
    const scene = this.scene(target);
    if (!scene) {
      this.session.ended = true;
      this.pushEnd(`Не найден переход: ${target}`);
      return false;
    }
    this.session.sceneId = target;
    this.session.ip = 0;
    this.session.branch = null;
    this.session.pendingChoice = null;
    this.session.tech.cg = '';
    return true;
  }
  executeTech(step) {
    const value = step.value || '';
    switch (step.command) {
      case 'BG': this.session.tech.bg = value; break;
      case 'CG': this.session.tech.cg = value; break;
      case 'MUSIC': this.session.tech.music = value; break;
      case 'SFX': this.session.tech.sfx = value; break;
      case 'SPRITE': this.session.tech.sprite = value; break;
      case 'REACTION': this.session.tech.reaction = value; break;
      case 'FADE': this.session.tech.fade = value; break;
      case 'SET': this.applySet(value); break;
      case 'CLEAR': this.applyClear(value); break;
      case 'SYSTEM': this.executeSystem(value); break;
      case 'GOTO': this.jumpTo(this.resolveGoto(value)); break;
      default: break;
    }
  }
  pushTimeline(entry) {
    this.session.timeline.push(entry);
    this.session.viewIndex = this.session.timeline.length - 1;
  }
  pushEnd(text) {
    const last = this.session.timeline[this.session.timeline.length - 1];
    if (last?.kind === 'end') return;
    this.pushTimeline({ kind: 'end', sceneId: this.session.sceneId, fragmentId: `END_${this.session.sceneId}`, text, beforeEngine: this.snapshot(), at: now() });
  }

  back() {
    if (!this.canBack()) return this.currentEntry();
    this.session.viewIndex--;
    return this.currentEntry();
  }

  async forward() {
    if (this.canForwardHistory()) {
      this.session.viewIndex++;
      return this.currentEntry();
    }
    return this.advance();
  }

  advance() {
    if (this.session.pendingChoice || this.session.ended) return this.currentEntry();
    let safety = 0;
    while (safety++ < 800) {
      const sequence = this.currentSequence();
      if (!sequence) { this.pushEnd('Не удалось восстановить ветку.'); break; }
      if (sequence.ip >= sequence.steps.length) {
        if (sequence.kind === 'branch') {
          const fallback = sequence.option?.fallbackGoto || sequence.option?.goto || null;
          this.session.branch = null;
          if (fallback) { this.jumpTo(this.resolveGoto(fallback)); continue; }
          // Inline choices can return to the main sequence in the same scene.
          // The scene IP already points to the first step after the choice.
          continue;
        }
        const sceneIndex = this.content.scenes.findIndex(scene => scene.id === this.session.sceneId);
        const nextScene = this.content.scenes[sceneIndex + 1];
        if (nextScene) { this.jumpTo(nextScene.id); continue; }
        this.session.ended = true;
        this.pushEnd('Конец доступного сценария.');
        break;
      }
      const index = sequence.ip;
      const step = sequence.steps[index];
      const beforeEngine = this.snapshot();
      this.setSequenceIp(sequence.kind, index + 1);
      if (step.type === 'choice') {
        this.session.pendingChoice = { sceneId: this.session.sceneId, choiceId: step.id };
        this.pushTimeline({ kind: 'choice', sceneId: this.session.sceneId, fragmentId: step.fragmentId, choiceId: step.id, selectedOptionId: null, selectedLabel: null, beforeEngine, at: now() });
        break;
      }
      if (step.type === 'tech') {
        if (step.command === 'IF' && !this.evaluateCondition(step.value)) {
          const scope = Number.isInteger(step.scope) && step.scope >= 0 ? step.scope : this.computeIfScope(sequence.steps, index);
          this.setSequenceIp(sequence.kind, Math.min(sequence.steps.length, index + 1 + scope));
          continue;
        }
        this.executeTech(step);
        if (this.session.ended) break;
        continue;
      }
      if (['dialogue', 'narration', 'thought'].includes(step.type)) {
        this.pushTimeline({ kind: 'fragment', sceneId: this.session.sceneId, fragmentId: step.fragmentId, beforeEngine, at: now() });
        break;
      }
    }
    this.session.updatedAt = now();
    return this.currentEntry();
  }

  choose(optionId) {
    const entry = this.currentEntry();
    if (!entry || entry.kind !== 'choice' || entry.selectedOptionId) return entry;
    const scene = this.scene(entry.sceneId);
    const choice = scene?.steps?.find(step => step.type === 'choice' && step.id === entry.choiceId);
    const option = choice?.options?.find(item => item.id === optionId);
    if (!option) return entry;
    if (option.condition && !this.evaluateCondition(option.condition)) return entry;

    const choiceVar = `CHOICE_${String(choice.id || '').replace(/[^A-Z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase()}`;
    if (choiceVar !== 'CHOICE_') this.setVariable(choiceVar, String(option.id || '').toUpperCase());

    entry.selectedOptionId = option.id;
    entry.selectedLabel = option.label;
    this.session.pendingChoice = null;
    this.session.branch = { choiceId: choice.id, optionId: option.id, ip: 0 };
    this.session.choices.push({ sceneId: entry.sceneId, choiceId: choice.id, optionId: option.id, label: option.label, at: now() });
    this.session.updatedAt = now();
    return this.advance();
  }

  replayFromCurrent() {
    const entry = this.currentEntry();
    if (!entry?.beforeEngine) return false;
    this.restore(entry.beforeEngine);
    this.session.timeline = this.session.timeline.slice(0, this.session.viewIndex + 1);
    this.session.viewIndex = this.session.timeline.length - 1;
    this.session.pendingChoice = entry.kind === 'choice' && !entry.selectedOptionId ? { sceneId: entry.sceneId, choiceId: entry.choiceId } : null;
    this.session.ended = false;
    return true;
  }
}

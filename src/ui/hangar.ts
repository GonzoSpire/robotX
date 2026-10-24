import type { GameSave } from '../core/save';
import { persistSave } from '../core/save';
import { computeLoadoutStats, type Loadout, type LoadoutStats } from '../meta/loadout';
import { autoEquip, craftPart, dismantlePart } from '../meta/crafting';
import { PILOT_BY_ID, PILOT_NODES } from '../meta/pilot';
import { PART_BY_ID, PARTS, RARITY_LABEL, RARITY_COLOR, BRAND_LABEL, SET_BONUS, dismantleValue, type PartDef, type PartKind } from '../meta/parts';
import { WEAPONS } from '../content/weapons';

type Tab = 'build' | 'warehouse' | 'pilot';

interface PartSlotRef {
  kind: 'chassis' | 'reactor' | 'weapon' | 'module';
  index: number; // для оружейных/модульных слотов
}

export interface HangarCallbacks {
  onStartRun: () => void;
  onOpenLobby: () => void;
}

const KIND_LABEL: Record<PartKind, string> = {
  chassis: 'Шасси',
  reactor: 'Реактор',
  weapon: 'Оружие',
  module: 'Модуль',
};

/** Ангар: конструктор робота, склад (крафт/разборка), дерево пилота. */
export class HangarScreen {
  readonly root: HTMLElement;
  private tab: Tab = 'build';
  private pick: PartSlotRef | null = null;
  private readonly tabContent: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly scrapChip: HTMLElement;

  constructor(
    uiRoot: HTMLElement,
    private readonly save: GameSave,
    private readonly cb: HangarCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'hangar-screen';
    this.root.className = 'screen';
    this.root.innerHTML = `
      <div class="hangar-wrap">
        <header class="hangar-top">
          <div class="hangar-title">ROBOT<em>X</em> <small>ангар</small></div>
          <div class="scrap-chip" id="hangar-scrap">⚙ 0</div>
        </header>
        <nav class="tabs">
          <button class="tab-btn" data-tab="build">КОНСТРУКТОР</button>
          <button class="tab-btn" data-tab="warehouse">СКЛАД</button>
          <button class="tab-btn" data-tab="pilot">ПИЛОТ</button>
        </nav>
        <main class="hangar-tab" id="hangar-tab"></main>
        <footer class="hangar-footer">
          <div class="hangar-summary" id="hangar-summary"></div>
          <div class="btn-row">
            <button class="btn" id="hangar-net">СЕТЬ</button>
            <button class="btn btn-primary" id="hangar-start">В ЗАБЕГ</button>
          </div>
        </footer>
      </div>
      <div class="pick-modal" id="pick-modal" style="display:none">
        <div class="panel pick-panel">
          <div class="pick-head"><span id="pick-title"></span><button class="btn pick-close" id="pick-close">✕</button></div>
          <div class="pick-list" id="pick-list"></div>
        </div>
      </div>
    `;
    uiRoot.appendChild(this.root);

    this.tabContent = this.must('hangar-tab');
    this.summaryEl = this.must('hangar-summary');
    this.startBtn = this.must('hangar-start') as HTMLButtonElement;
    this.scrapChip = this.must('hangar-scrap');

    this.root.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as Tab;
        this.render();
      });
    });
    this.startBtn.addEventListener('click', () => {
      if (this.computeStats().valid) this.cb.onStartRun();
    });
    this.must('hangar-net').addEventListener('click', () => this.cb.onOpenLobby());
    this.must('pick-close').addEventListener('click', () => this.closePick());
  }

  private must(id: string): HTMLElement {
    const el = this.root.querySelector(`#${id}`);
    if (!el) throw new Error(`hangar element #${id} missing`);
    return el as HTMLElement;
  }

  show(): void {
    this.root.classList.add('show');
    this.render();
  }

  hide(): void {
    this.root.classList.remove('show');
    this.closePick();
  }

  private mutate(fn: (s: GameSave) => void): void {
    fn(this.save);
    persistSave(this.save);
    this.render();
  }

  private computeStats(): LoadoutStats {
    return computeLoadoutStats(this.save.loadout, this.save.pilot);
  }

  // ---------- рендер ----------

  private render(): void {
    this.scrapChip.textContent = `⚙ ${this.save.scrap}`;
    this.root.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === this.tab);
    });
    if (this.tab === 'build') this.renderBuild();
    else if (this.tab === 'warehouse') this.renderWarehouse();
    else this.renderPilot();

    const stats = this.computeStats();
    this.summaryEl.innerHTML = `
      <span>HP <b>${Math.round(stats.hp)}</b></span>
      <span>СК <b>${stats.speed.toFixed(1)}</b></span>
      <span>⚡ <b class="${stats.energyUsed > stats.energyCapacity ? 'bad' : ''}">${stats.energyUsed}/${stats.energyCapacity}</b></span>
      <span>ПУШКИ <b>${stats.weapons.length}/${stats.weaponSlots}</b></span>
    `;
    this.startBtn.disabled = !stats.valid;
    this.startBtn.title = stats.errors.join('\n');
  }

  private renderBuild(): void {
    const l = this.save.loadout;
    const stats = this.computeStats();
    const chassis = PART_BY_ID[l.chassis];
    const slots: string[] = [];

    slots.push(this.slotHtml('chassis', 0, PART_BY_ID[l.chassis]));
    slots.push(this.slotHtml('reactor', 0, PART_BY_ID[l.reactor]));

    for (let i = 0; i < (chassis.chassis?.weaponSlots ?? 3); i++) {
      slots.push(this.slotHtml('weapon', i, l.weapons[i] ? PART_BY_ID[l.weapons[i]] : null));
    }
    for (let i = 0; i < (chassis.chassis?.moduleSlots ?? 2); i++) {
      slots.push(this.slotHtml('module', i, l.modules[i] ? PART_BY_ID[l.modules[i]] : null));
    }

    const setsHtml = stats.sets
      .map((s) => {
        const cls = s.active ? 'set active' : 'set';
        return `<div class="${cls}">${BRAND_LABEL[s.brand]} ×${s.count}${s.active ? ` — ${SET_BONUS[s.brand].desc}` : ''}</div>`;
      })
      .join('');

    this.tabContent.innerHTML = `
      <div class="slot-grid">${slots.join('')}</div>
      <div class="energy-block">
        <div class="energy-label">ЭНЕРГИЯ <b class="${stats.energyUsed > stats.energyCapacity ? 'bad' : ''}">${stats.energyUsed}/${stats.energyCapacity}</b></div>
        <div class="bar energy"><div class="bar-fill ${stats.energyUsed > stats.energyCapacity ? 'over' : ''}" style="width:${Math.min(100, (stats.energyUsed / stats.energyCapacity) * 100)}%"></div></div>
        <div class="sets">${setsHtml}</div>
      </div>
      ${stats.errors.length ? `<div class="loadout-errors">${stats.errors.map((e) => `⚠ ${e}`).join('<br/>')}</div>` : ''}
    `;

    this.tabContent.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) => {
      b.addEventListener('click', () => {
        const [kind, idx] = b.dataset.slot!.split(':');
        this.openPick({ kind: kind as PartSlotRef['kind'], index: Number(idx) });
      });
    });
  }

  private slotHtml(kind: PartSlotRef['kind'], index: number, part: PartDef | null | undefined): string {
    if (part) {
      const c = RARITY_COLOR[part.rarity];
      return `<button class="part-slot filled" data-slot="${kind}:${index}" style="--rc:${c}">
        <span class="ps-icon">${part.icon}</span>
        <span class="ps-name">${part.name}</span>
        <span class="ps-meta">${KIND_LABEL[kind === 'chassis' || kind === 'reactor' ? kind : part.kind]}${part.energy ? ` · ⚡${part.energy}` : ''}</span>
      </button>`;
    }
    return `<button class="part-slot empty" data-slot="${kind}:${index}">
      <span class="ps-icon">+</span>
      <span class="ps-name">${KIND_LABEL[kind]}</span>
      <span class="ps-meta">пусто</span>
    </button>`;
  }

  // ---------- модалка выбора детали ----------

  private openPick(ref: PartSlotRef): void {
    this.pick = ref;
    const candidates = this.save.owned
      .map((id) => PART_BY_ID[id])
      .filter((p) => p && p.kind === ref.kind && !this.isEquipped(p.id));
    // отсортируем по редкости
    candidates.sort((a, b) => a.craftCost - b.craftCost);

    const rows = candidates.map((p) => {
      const c = RARITY_COLOR[p.rarity];
      return `<button class="pick-row" data-id="${p.id}" style="--rc:${c}">
        <span class="pr-icon">${p.icon}</span>
        <span class="pr-body">
          <span class="pr-name">${p.name} <small>${RARITY_LABEL[p.rarity]}${p.brand ? ` · ${BRAND_LABEL[p.brand]}` : ''}</small></span>
          <span class="pr-desc">${partDescHtml(p)}</span>
        </span>
        <span class="pr-energy">${p.energy ? `⚡${p.energy}` : ''}</span>
      </button>`;
    });

    this.must('pick-title').textContent = KIND_LABEL[ref.kind as PartKind];
    const listHtml = rows.length
      ? rows.join('')
      : `<div class="empty-note">Нет свободных деталей этого типа.<br/>Чертежи падают в забегах — крафт на вкладке «Склад».</div>`;
    this.must('pick-list').innerHTML =
      listHtml + (this.canUnequip(ref) ? `<button class="pick-row unequip" data-id=""><span class="pr-icon">✖</span><span class="pr-body"><span class="pr-name">Снять деталь</span></span></button>` : '');
    this.must('pick-modal').style.display = 'flex';

    this.must('pick-list').querySelectorAll<HTMLButtonElement>('.pick-row').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.id ?? '';
        this.applyPick(id);
      });
    });
  }

  private isEquipped(partId: string): boolean {
    const l = this.save.loadout;
    return l.chassis === partId || l.reactor === partId || l.weapons.includes(partId) || l.modules.includes(partId);
  }

  private canUnequip(ref: PartSlotRef): boolean {
    const l = this.save.loadout;
    if (ref.kind === 'chassis' || ref.kind === 'reactor') return false;
    if (ref.kind === 'weapon') return Boolean(l.weapons[ref.index]);
    return Boolean(l.modules[ref.index]);
  }

  private applyPick(id: string): void {
    const ref = this.pick;
    if (!ref) return;
    this.mutate((s) => {
      const l = s.loadout;
      if (ref.kind === 'chassis') {
        l.chassis = id || 'chassis_rust';
        // при смене шасси лишние детали вылетают из слотов
        const wS = PART_BY_ID[l.chassis].chassis?.weaponSlots ?? 3;
        const mS = PART_BY_ID[l.chassis].chassis?.moduleSlots ?? 2;
        l.weapons = l.weapons.slice(0, wS);
        l.modules = l.modules.slice(0, mS);
      } else if (ref.kind === 'reactor') {
        l.reactor = id || 'reactor_old';
      } else if (ref.kind === 'weapon') {
        const arr = [...l.weapons];
        if (!id) arr.splice(ref.index, 1);
        else arr[ref.index] = id;
        l.weapons = arr.filter(Boolean);
      } else {
        const arr = [...l.modules];
        if (!id) arr.splice(ref.index, 1);
        else arr[ref.index] = id;
        l.modules = arr.filter(Boolean);
      }
    });
    this.closePick();
  }

  private closePick(): void {
    this.pick = null;
    this.must('pick-modal').style.display = 'none';
  }

  // ---------- склад ----------

  private renderWarehouse(): void {
    const s = this.save;
    const craftable = PARTS.filter((p) => s.blueprints.includes(p.id));
    const owned = s.owned.map((id) => PART_BY_ID[id]).filter(Boolean);

    const craftHtml = craftable.length
      ? craftable
          .map((p) => {
            const afford = s.scrap >= p.craftCost;
            return `<div class="part-card" style="--rc:${RARITY_COLOR[p.rarity]}">
              <div class="pc-head">${p.icon} ${p.name} <small>${RARITY_LABEL[p.rarity]}</small></div>
              <div class="pc-desc">${partDescHtml(p)}</div>
              <button class="btn craft-btn" data-craft="${p.id}" ${afford ? '' : 'disabled'}>КРАФТ · ⚙${p.craftCost}</button>
            </div>`;
          })
          .join('')
      : '<div class="empty-note">Чертежей нет — падают с големов (25%) и босса (100%).</div>';

    const stockHtml = owned
      .map((p) => {
        const equipped = this.isEquipped(p.id);
        const canScrap = !equipped && !p.starter;
        return `<div class="part-card ${equipped ? 'equipped' : ''}" style="--rc:${RARITY_COLOR[p.rarity]}">
          <div class="pc-head">${p.icon} ${p.name} <small>${RARITY_LABEL[p.rarity]}</small></div>
          <div class="pc-desc">${partDescHtml(p)}</div>
          <div class="pc-foot">
            ${equipped ? '<span class="eq-mark">НА РОБОТЕ</span>' : ''}
            ${canScrap ? `<button class="btn scrap-btn" data-scrap="${p.id}">Разобрать +⚙${dismantleValue(p)}</button>` : ''}
          </div>
        </div>`;
      })
      .join('');

    this.tabContent.innerHTML = `
      <h3 class="sec-title">ЧЕРТЕЖИ</h3>
      <div class="part-grid">${craftHtml}</div>
      <h3 class="sec-title">СКЛАД</h3>
      <div class="part-grid">${stockHtml}</div>
    `;

    this.tabContent.querySelectorAll<HTMLButtonElement>('[data-craft]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.craft!;
        this.mutate((sv) => {
          const res = craftPart(id, sv.scrap, sv.owned, sv.blueprints);
          if (res.result.ok) {
            sv.scrap = res.scrap;
            sv.owned = res.owned;
            sv.blueprints = res.blueprints;
            const part = PART_BY_ID[id];
            const wS = PART_BY_ID[sv.loadout.chassis].chassis?.weaponSlots ?? 3;
            const mS = PART_BY_ID[sv.loadout.chassis].chassis?.moduleSlots ?? 2;
            sv.loadout = autoEquip(part, sv.loadout, { weaponSlots: wS, moduleSlots: mS });
          }
        });
      });
    });

    this.tabContent.querySelectorAll<HTMLButtonElement>('[data-scrap]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.scrap!;
        this.mutate((sv) => {
          const res = dismantlePart(id, sv.scrap, sv.owned, sv.loadout);
          if (res.result.ok) {
            sv.scrap = res.scrap;
            sv.owned = res.owned;
          }
        });
      });
    });
  }

  // ---------- пилот ----------

  private renderPilot(): void {
    const s = this.save;
    const nodes = PILOT_NODES.map((n) => {
      const rank = s.pilot[n.id] ?? 0;
      const maxed = rank >= n.maxRank;
      const cost = maxed ? 0 : n.costs[rank];
      const afford = !maxed && s.scrap >= cost;
      const dots = Array.from({ length: n.maxRank }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
      return `<div class="pilot-row">
        <span class="pr-ico">${n.icon}</span>
        <span class="pr-body">
          <span class="pr-name">${n.name} <span class="rank-dots">${dots}</span></span>
          <span class="pr-desc">${n.desc}</span>
        </span>
        <button class="btn" data-pilot="${n.id}" ${afford ? '' : 'disabled'}>${maxed ? 'МАКС' : `⚙${cost}`}</button>
      </div>`;
    }).join('');

    this.tabContent.innerHTML = `
      <div class="empty-note" style="margin-bottom:8px">Постоянные бонусы пилота — действуют в каждом забеге.</div>
      ${nodes}
    `;

    this.tabContent.querySelectorAll<HTMLButtonElement>('[data-pilot]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.pilot!;
        this.mutate((sv) => {
          const node = PILOT_BY_ID[id];
          const rank = sv.pilot[id] ?? 0;
          if (!node || rank >= node.maxRank) return;
          const cost = node.costs[rank];
          if (sv.scrap < cost) return;
          sv.scrap -= cost;
          sv.pilot[id] = rank + 1;
        });
      });
    });
  }
}

export function partDescHtml(p: PartDef): string {
  if (p.kind === 'chassis' && p.chassis) {
    const c = p.chassis;
    return `HP ${c.hp} · ск ${c.speed} · ${c.weaponSlots} пушки · ${c.moduleSlots} модуля`;
  }
  if (p.kind === 'reactor' && p.reactor) {
    const r = p.reactor;
    const perks = [r.damagePct ? `+${Math.round(r.damagePct * 100)}% урона` : '', r.attackSpeedPct ? `+${Math.round(r.attackSpeedPct * 100)}% атаки` : '']
      .filter(Boolean)
      .join(', ');
    return `⚡ ${r.capacity} энергии${perks ? ` · ${perks}` : ''}`;
  }
  if (p.kind === 'weapon' && p.weapon) {
    return `${WEAPONS[p.weapon].desc} (старт. оружие забега)`;
  }
  return p.desc;
}

export type { Loadout };

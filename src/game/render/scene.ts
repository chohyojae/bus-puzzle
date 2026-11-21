import { Application, Assets, Container, Graphics, Sprite, Text, type Texture, type Ticker } from 'pixi.js';
import type { RoundDefinition } from '../../content/round-schema';
import { required } from '../../required';
import type { Settings } from '../../storage/save-schema';
import { directionDelta } from '../domain/occupancy';
import type { GameEvent, GameState, TransitionResult } from '../domain/types';
import { startFrameLoop } from './frame-loop';
import { palette } from './palette';

export const BOARD_WIDTH = 560,
  BOARD_HEIGHT = 630;
export function boardLayout(round: RoundDefinition) {
  const cell = Math.min(94, 452 / round.grid.cols, 340 / round.grid.rows);
  return { cell, left: (560 - cell * round.grid.cols) / 2, top: 254 + (340 - cell * round.grid.rows) / 2 };
}
const angles = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };
const urls = import.meta.glob<string>('../../content/shared-assets/bus-*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

export class GameScene {
  readonly app = new Application();
  private disposed = false;
  private ready = false;
  private sprites = new Map<string, Sprite>();
  private seatLabels = new Map<string, Text>();
  private passengers: Container[] = [];
  private queue: TransitionResult[] = [];
  private processing = false;
  private tweenActive = false;
  private stopFrames?: () => void;
  private cancelTween: (() => void) | undefined;
  private paused = false;
  private view: GameState;
  private slots: Graphics[] = [];
  private visibility = () => this.syncTicker();

  constructor(
    private round: RoundDefinition,
    state: GameState,
    private settings: Settings,
    private onSettled: () => void,
    private onError: (message: string) => void,
  ) {
    this.view = structuredClone(state);
  }

  async init(host: HTMLElement) {
    await this.app.init({
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      autoStart: false,
      preference: 'webgl',
    });
    this.ready = true;
    if (this.disposed) {
      this.app.destroy(true, { children: true });
      return;
    }
    host.append(this.app.canvas);
    this.app.canvas.setAttribute('aria-hidden', 'true');
    this.app.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.app.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    const textures = await Promise.all(
      Object.keys(palette).map(
        async (color) =>
          [color, await Assets.load<Texture>(urls[`../../content/shared-assets/bus-${color}.svg`])] as const,
      ),
    );
    if (this.disposed) return;
    this.build(new Map(textures));
    document.addEventListener('visibilitychange', this.visibility);
    this.configure(this.settings);
    this.draw();
    if (this.queue.length) void this.process();
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.paused = true;
    this.syncTicker();
    this.onError(
      '그래픽 연결이 일시 중단되었습니다. 진행은 저장되어 있습니다. 새로고침하면 이어서 플레이할 수 있어요.',
    );
  };
  private onContextRestored = () => {
    this.paused = false;
    this.draw();
    this.syncTicker();
  };

  private label(text: string, x: number, y: number, size = 16, color = 0x8fa6c4) {
    const label = new Text({
      text,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fill: color, fontWeight: '600' },
    });
    label.anchor.set(0.5);
    label.position.set(x, y);
    this.app.stage.addChild(label);
    return label;
  }

  private build(textures: Map<string, Texture>) {
    const background = new Graphics()
      .roundRect(12, 14, 536, 602, 28)
      .fill(0x192941)
      .stroke({ color: 0x334b69, width: 2 });
    background.roundRect(38, 55, 484, 74, 37).stroke({ color: 0x314965, width: 20 });
    for (let i = 0; i < 16; i++) background.roundRect(55 + i * 29, 88, 12, 3, 2).fill(0x6a819e);
    this.app.stage.addChild(background);
    this.label('다음 승객', 94, 37, 14);
    this.label('승차 플랫폼', 280, 151, 14);
    for (let i = 0; i < this.round.platformSlotCount; i++) {
      const { x, width } = this.slotPosition(i);
      const slot = new Graphics()
        .roundRect(x - width / 2, 170, width, 69, 13)
        .stroke({ color: 0x5b7391, width: 2 });
      this.app.stage.addChild(slot);
      this.slots.push(slot);
      this.label(`P${i + 1}`, x, 205, 15, 0x617a99);
    }
    const { left, top, cell } = boardLayout(this.round);
    const grid = new Graphics()
      .roundRect(left - 8, top - 8, cell * this.round.grid.cols + 16, cell * this.round.grid.rows + 16, 17)
      .fill(0x132136)
      .stroke({ color: 0x314b6a, width: 2 });
    for (let r = 0; r < this.round.grid.rows; r++)
      for (let c = 0; c < this.round.grid.cols; c++)
        grid
          .roundRect(left + c * cell + 3, top + r * cell + 3, cell - 6, cell - 6, 9)
          .stroke({ color: 0x2c405b, width: 1 });
    this.app.stage.addChild(grid);
    for (const v of this.round.vehicles) {
      const sprite = new Sprite(textures.get(v.color));
      sprite.anchor.set(0.5);
      this.app.stage.addChild(sprite);
      this.sprites.set(v.id, sprite);
      const label = this.label('', 0, 0, 13, 0xdce8f5);
      this.seatLabels.set(v.id, label);
    }
    for (let i = 0; i < 10; i++) {
      const person = new Container();
      const body = new Graphics().roundRect(-9, 0, 18, 17, 6).fill(0xffffff).circle(0, -7, 8).fill(0xffffff);
      const symbol = new Text({
        text: '',
        style: { fontFamily: 'sans-serif', fontSize: 10, fill: 0x162b3e, fontWeight: 'bold' },
      });
      symbol.anchor.set(0.5);
      symbol.y = 8;
      person.addChild(body, symbol);
      this.passengers.push(person);
      this.app.stage.addChild(person);
    }
  }

  private slotPosition(slot: number) {
    const width = Math.min(132, 454 / this.round.platformSlotCount - 12);
    return { x: 280 + (slot - (this.round.platformSlotCount - 1) / 2) * (width + 14), y: 202, width };
  }

  private draw() {
    if (!this.ready || this.disposed || this.sprites.size === 0) return;
    const { left, top, cell } = boardLayout(this.round);
    for (const v of this.round.vehicles) {
      const sprite = required(this.sprites.get(v.id));
      const seat = required(this.seatLabels.get(v.id));
      const slot = this.view.platformSlots.findIndex((p) => p?.vehicleId === v.id);
      const parked = this.view.parkingVehicleIds.includes(v.id);
      sprite.visible = parked || slot >= 0;
      sprite.alpha = 1;
      seat.visible = slot >= 0;
      if (parked) {
        const pose = this.view.vehiclePoseById[v.id];
        sprite.position.set(left + (pose.col + 0.5) * cell, top + (pose.row + 0.5) * cell);
        sprite.rotation = angles[pose.direction];
        sprite.width = cell * 0.75;
        sprite.height = cell * 0.83;
      } else if (slot >= 0) {
        const position = this.slotPosition(slot);
        sprite.position.set(position.x - 17, position.y);
        sprite.rotation = Math.PI / 2;
        sprite.width = 42;
        sprite.height = 47;
        seat.text = `${required(this.view.platformSlots[slot]).boardedCount}/${v.capacity}`;
        seat.position.set(position.x + 36, position.y);
      }
    }
    for (let i = 0; i < this.passengers.length; i++) {
      const color = this.round.passengers[this.view.passengerIndex + i];
      const person = this.passengers[i];
      person.visible = !!color;
      person.alpha = 1;
      person.position.set(68 + i * 45, 89);
      if (color) {
        (person.children[0] as Graphics).tint = palette[color].value;
        (person.children[1] as Text).text = palette[color].symbol;
      }
    }
    this.app.render();
  }

  configure(settings: Settings) {
    const changed = this.settings.frameRate !== settings.frameRate;
    this.settings = settings;
    if (changed) {
      this.stopFrames?.();
      this.stopFrames = undefined;
      this.syncTicker();
    }
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.syncTicker();
  }
  private syncTicker() {
    if (!this.ready || this.disposed || !this.tweenActive || this.paused || document.hidden) {
      this.stopFrames?.();
      this.stopFrames = undefined;
    } else if (!this.stopFrames) {
      this.app.ticker.lastTime = performance.now();
      this.stopFrames = startFrameLoop(this.settings.frameRate, (now) => this.app.ticker.update(now));
    }
  }

  enqueue(result: TransitionResult) {
    this.queue.push(result);
    if (this.sprites.size && !this.processing && !this.tweenActive) void this.process();
  }
  private async process() {
    if (this.processing || this.disposed) return;
    this.processing = true;
    while (this.queue.length && !this.disposed) {
      const result = required(this.queue.shift());
      for (const event of result.events) {
        if (this.disposed) break;
        await this.animateEvent(event);
      }
      this.view = structuredClone(result.nextState);
      this.draw();
    }
    this.processing = false;
    if (!this.disposed) this.onSettled();
  }

  private tween(duration: number, update: (progress: number) => void) {
    if (this.disposed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let elapsed = 0;
      const finish = () => {
        this.app.ticker.remove(tick);
        this.tweenActive = false;
        this.cancelTween = undefined;
        this.syncTicker();
        resolve();
      };
      const tick = (ticker: Ticker) => {
        elapsed += Math.min(ticker.deltaMS, 50);
        const p = Math.min(1, elapsed / (this.settings.reducedMotion ? 24 : duration));
        update(1 - (1 - p) ** 3);
        if (p === 1) finish();
      };
      this.cancelTween = finish;
      this.tweenActive = true;
      this.app.ticker.add(tick);
      this.syncTicker();
    });
  }

  private async animateEvent(event: GameEvent) {
    if (event.type === 'round-won' || event.type === 'round-lost') return;
    const sprite = required(this.sprites.get(event.vehicleId));
    if (event.type === 'vehicle-dispatched') {
      const pose = this.view.vehiclePoseById[event.vehicleId];
      const [dr, dc] = directionDelta[pose.direction];
      const x = sprite.x,
        y = sprite.y;
      await this.tween(160, (p) => {
        sprite.x = x + dc * 52 * p;
        sprite.y = y + dr * 52 * p;
        sprite.alpha = 1 - p;
      });
      if (this.disposed) return;
      this.view.parkingVehicleIds = this.view.parkingVehicleIds.filter((id) => id !== event.vehicleId);
      this.view.platformSlots[event.slotIndex] = {
        vehicleId: event.vehicleId,
        boardedCount: 0,
        arrivalOrder: this.view.nextArrivalOrder++,
      };
      this.draw();
      const target = this.slotPosition(event.slotIndex);
      await this.tween(180, (p) => {
        sprite.y = target.y + 25 * (1 - p);
        sprite.alpha = p;
      });
    } else if (event.type === 'passenger-boarded') {
      const person = this.passengers[0];
      const x = person.x,
        y = person.y;
      await this.tween(80, (p) => {
        person.x = x + (sprite.x - x) * p;
        person.y = y + (sprite.y - y) * p;
        person.alpha = 1 - p;
      });
      this.view.passengerIndex = event.passengerIndex + 1;
      const slot = this.view.platformSlots[event.slotIndex];
      if (slot) slot.boardedCount = event.boardedCount;
      this.draw();
    } else {
      const x = sprite.x;
      await this.tween(220, (p) => {
        sprite.x = x + 150 * p;
        sprite.alpha = 1 - p;
      });
      this.view.platformSlots[event.slotIndex] = null;
      this.draw();
    }
  }

  async reject(id: string, reason: string) {
    if (this.processing || this.tweenActive || !this.ready || this.disposed) return;
    if (reason === 'platform-full') {
      await this.tween(250, (p) => {
        for (const slot of this.slots) slot.tint = p < 0.85 ? 0xff6e72 : 0xffffff;
      });
    } else if (reason === 'blocked-path') {
      const sprite = this.sprites.get(id);
      if (!sprite) return;
      const { direction } = this.view.vehiclePoseById[id];
      const [dr, dc] = directionDelta[direction],
        x = sprite.x,
        y = sprite.y;
      await this.tween(260, (p) => {
        const bump = Math.sin(p * Math.PI * 2) * 10 * (1 - p);
        sprite.x = x + dc * bump;
        sprite.y = y + dr * bump;
      });
    }
    this.draw();
    if (this.queue.length && !this.processing) void this.process();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.queue = [];
    document.removeEventListener('visibilitychange', this.visibility);
    this.cancelTween?.();
    if (this.ready) {
      this.app.canvas.removeEventListener('webglcontextlost', this.onContextLost);
      this.app.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
      this.app.destroy(true, { children: true });
    }
  }
}

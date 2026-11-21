import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { Icon } from '../../app/icons';
import { Modal } from '../../app/Modal';
import { SettingsScreen } from '../../app/screens/SettingsScreen';
import { UpdateNotice } from '../../pwa/UpdateNotice';
import { type SaveController, useSave } from '../../storage/use-save';
import { feedback } from '../render/feedback';
import { startFrameLoop } from '../render/frame-loop';
import garage from './art/garage.webp';
import garden from './art/garden.webp';
import lighthouse from './art/lighthouse.webp';
import { type BoardHandle, DepotBoard } from './DepotBoard';
import {
  activeQueueSide,
  type DepotState,
  dispatchBus,
  isBlindBus,
  queuePoses,
  recommendBus,
  tickLiveDepot,
} from './logic';
import {
  checkpoint,
  type DepotSession,
  newSession,
  openDepot,
  previousDepotRun,
  storeDepotRun,
  undoDispatch,
} from './session';
import { busColors, stops } from './stages';
import './depot.css';

type Panel = 'pause' | 'help' | 'restart' | 'stages' | 'settings' | null;
interface Cue {
  message: string;
  highlight?: string;
  rejected?: string;
}

function visibleState(game: DepotState) {
  return (
    game.status +
    game.boardedCount +
    game.buses.map((b) => (isBlindBus(game, b) ? 'masked' : b.phase)).join() +
    game.passengers.map((p) => p.id).join() +
    ':' +
    queuePoses(game)
      .map((p) => p.id)
      .join()
  );
}
function HintIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M9 16c0-2.3-3-3-3-7a6 6 0 0 1 12 0c0 4-3 4.7-3 7zM9.5 19h5M11 22h2" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 22 22" width="19" height="19" fill="currentColor">
      <circle cx="9" cy="6" r="3.3" />
      <path d="M2 18v-2a7 7 0 0 1 14 0v2z" />
      <path d="M15 3.4a3.1 3.1 0 0 1 0 6c1.4-1.9 1.4-4.1 0-6ZM16 11a5.2 5.2 0 0 1 5 5.2V18h-3v-1.8c0-1.8-.6-3.6-2-5.2Z" />
    </svg>
  );
}

function Play({ storage }: { storage: SaveController }) {
  const [initial] = useState(() => openDepot(storage.latest()));
  const session = useRef(initial);
  const live = useCallback(() => session.current.game, []);
  const board = useRef<BoardHandle>(null);
  const [view, setView] = useState(initial.game);
  const visible = useRef(visibleState(initial.game));
  const [panel, setPanel] = useState<Panel>(null);
  const [cue, setCue] = useState<Cue | null>(null);
  const [hidden, setHidden] = useState(document.hidden);
  const { settings } = storage.save;
  const { mutate, latest, locked } = storage;
  const active = !panel && !hidden && !locked && view.status === 'playing';
  const currentStop = stops[view.level - 1];

  // Keep animation positions out of React. The interface changes when a passenger or bus changes state.
  const persist = useCallback(
    (win = false) => {
      const run = checkpoint(session.current);
      mutate((old) => {
        const saved = storeDepotRun(old, run);
        if (!win) return saved;
        const stamp = new Date().toISOString();
        const oldProgress = old.roundProgressById[run.stageId];
        return {
          ...saved,
          roundProgressById: {
            ...old.roundProgressById,
            [run.stageId]: {
              cleared: true,
              firstClearedAt: oldProgress?.firstClearedAt ?? stamp,
              lastClearedAt: stamp,
              clearCount: (oldProgress?.clearCount ?? 0) + 1,
              clearedRevision: 1,
            },
          },
        };
      });
    },
    [mutate],
  );

  const advance = useEffectEvent((seconds: number) => {
    const before = session.current.game;
    const game = tickLiveDepot(before, seconds);
    session.current.game = game;
    board.current?.paint(game);
    if (
      before.buses === game.buses &&
      before.passengers === game.passengers &&
      before.queue === game.queue &&
      before.lineOffset === game.lineOffset &&
      before.rightLineOffset === game.rightLineOffset &&
      before.status === game.status
    )
      return;
    const key = visibleState(game);
    if (key !== visible.current) {
      visible.current = key;
      setView(game);
      persist(game.status === 'won');
    }
  });
  useEffect(() => {
    if (!active) return;
    return startFrameLoop(settings.frameRate, (_now, elapsed) => {
      advance(Math.min(elapsed / 1000, 0.2));
    });
  }, [active, settings.frameRate]);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  useEffect(() => {
    if (!cue) return;
    const timer = window.setTimeout(() => setCue(null), 3200);
    return () => window.clearTimeout(timer);
  }, [cue]);

  function changeSession(next: DepotSession) {
    session.current = next;
    visible.current = visibleState(next.game);
    setView(next.game);
    setPanel(null);
    setCue(null);
    persist();
  }

  function select(id: string) {
    if (!active || session.current.game.status !== 'playing') return;
    const { game, moves, previous } = session.current;
    const result = dispatchBus(game, id);
    if (result.reason) {
      if (result.reason === 'unavailable') return;
      feedback(settings, false);
      setCue(
        result.reason === 'blocked'
          ? {
              message: '앞길이 막혔어요. 앞에 있는 버스를 먼저 보내세요.',
              rejected: id,
              highlight: result.blockerId,
            }
          : { message: '승강장이 꽉 찼어요. 빈자리가 날 때까지 기다려 주세요.' },
      );
      return;
    }
    feedback(settings, true);
    const next = {
      ...session.current,
      game: result.state,
      moves: [...moves, { id, at: game.elapsed }],
      previous: [...previous, game],
    };
    changeSession(next);
  }

  function undo() {
    if (locked) return;
    const previous = undoDispatch(session.current);
    if (!previous) return;
    changeSession(previous);
    setCue({ message: '마지막으로 보낸 버스가 돌아왔어요.' });
  }

  function hint() {
    if (!active) return;
    const game = session.current.game;
    const suggested = recommendBus(game);
    const bus = game.buses.find((b) => b.id === suggested);
    setCue(
      bus
        ? { message: `${busColors[bus.color].name} 버스를 보내 보세요.`, highlight: bus.id }
        : { message: '지금은 승강장에서 승객을 태울 차례예요.' },
    );
  }

  function openPanel(next: Panel) {
    if (!locked && session.current.moves.length && view.status === 'playing') persist();
    setCue(null);
    setPanel(next);
  }
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape' && active) {
      event.preventDefault();
      openPanel('pause');
    }
  });
  useEffect(() => {
    const handle = (event: KeyboardEvent) => keyboard(event);
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  const panelBack = () => setPanel('pause');
  const canUndo = session.current.previous.length > 0 && !locked && view.status !== 'won';
  const startLevel = (level: number) => {
    if (!locked) changeSession(newSession(level));
  };
  const result = !panel && view.status !== 'playing';
  const known = storage.save.roundProgressById;
  const queueSide = view.layout === 'compact' ? activeQueueSide(view) : null;

  return (
    <main
      className={`depot-app depot-${view.layout}${settings.reducedMotion ? ' reduce-motion' : ''}`}
      aria-label="Bus Puzzle"
    >
      <div className="depot-stage">
        <DepotBoard
          ref={board}
          state={view}
          live={live}
          active={active}
          reduced={settings.reducedMotion}
          running={active}
          highlight={cue?.highlight}
          rejected={cue?.rejected}
          onSelect={select}
        />
        <div className="depot-hud">
          <button
            type="button"
            className="depot-pill depot-level"
            onClick={() => openPanel('stages')}
            aria-label={`${view.level}단계 · 단계 선택`}
          >
            <span>{view.level}단계</span>
          </button>
          <button
            type="button"
            className="depot-pause"
            aria-label="일시정지"
            onClick={() => openPanel('pause')}
          >
            <Icon name="pause" size={21} />
          </button>
          <div className="depot-pill depot-count">
            <PeopleIcon />
            <span>남은 승객</span>
            <b data-testid="passenger-count">{view.totalPassengers - view.boardedCount}</b>
          </div>
          {view.layout === 'compact' && (
            <div className="depot-queue-details">
              <div className="depot-queue-count">
                대기 줄 <b>{view.queue.length}</b>명
              </div>
              <div className="depot-queue-source" aria-live="polite" aria-atomic="true">
                {queueSide && (
                  <span data-side={queueSide}>
                    <Icon name="back" size={12} />
                    {queueSide === 'left' ? '왼쪽 줄 입장 중' : '오른쪽 줄 입장 중'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="depot-cue" role="status">
          {cue && <span key={cue.message}>{cue.message}</span>}
        </div>
        <div className="depot-controls">
          <button type="button" className="depot-action ivory" onClick={undo} disabled={!canUndo}>
            <Icon name="undo" />
            되돌리기
          </button>
          <button
            type="button"
            className="depot-hint"
            aria-label="힌트"
            title="힌트"
            onClick={hint}
            disabled={!active}
          >
            <HintIcon />
          </button>
          <button
            type="button"
            className="depot-action ocean"
            onClick={() => openPanel('restart')}
            disabled={locked}
          >
            <Icon name="restart" />
            다시 시작
          </button>
        </div>
      </div>
      {storage.warning && (
        <div className="depot-warning" role="alert">
          {storage.warning}{' '}
          <button type="button" onClick={() => openPanel('settings')}>
            저장 설정
          </button>
        </div>
      )}
      {panel === 'pause' && (
        <Modal title="일시정지" onClose={() => setPanel(null)}>
          <img className="depot-vignette" src={garage} alt="" />
          <p>
            {view.level}단계 · {currentStop.name}
          </p>
          <div className="depot-menu">
            <button className="ocean" type="button" onClick={() => setPanel(null)}>
              <Icon name="play" />
              계속하기
            </button>
            <button type="button" onClick={() => setPanel('help')}>
              게임 방법
            </button>
            {previousDepotRun(storage.save) && (
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  changeSession(openDepot(latest(), view.layout === 'compact' ? 'promenade' : 'compact'))
                }
              >
                {view.layout === 'compact' ? '이전 배치 이어하기' : '새 배치로 돌아가기'}
              </button>
            )}
            <button type="button" onClick={() => setPanel('stages')}>
              단계 선택
            </button>
            <button type="button" onClick={() => setPanel('settings')}>
              <Icon name="settings" size={17} />
              설정
            </button>
            <button type="button" disabled={locked} onClick={() => setPanel('restart')}>
              다시 시작
            </button>
          </div>
        </Modal>
      )}
      {panel === 'help' && (
        <Modal title="게임 방법" onClose={panelBack}>
          <ol className="depot-guide">
            <li>
              앞이 비어 있는 버스를 누르면 화살표 방향으로 빠져나와요.
              {view.fleetVersion >= 2 && ' 지붕의 숫자는 태울 수 있는 승객 수예요.'}
            </li>
            <li>
              순환로를 도는 승객은 같은 색 버스에 타요. 빈자리는 줄에서 기다리던 승객이 채워요.
              {view.layout === 'compact' && ' 왼쪽 줄이 먼저예요. 왼쪽 줄이 다 들어오면 오른쪽 줄 차례예요.'}
            </li>
            <li>
              승강장은 {view.layout === 'compact' ? '일곱' : '세'} 자리예요. 순환로에 없는 색으로 자리를 다
              채우면 더는 출차할 수 없어요.
            </li>
            <li>단계가 오르면 색이 늘어나요. 검은 물음표 버스는 앞길이 열리는 순간 원래 색이 보여요.</li>
          </ol>
          <div className="depot-menu">
            <button className="ocean" type="button" onClick={() => setPanel(null)}>
              게임으로
            </button>
          </div>
        </Modal>
      )}
      {panel === 'restart' && (
        <Modal title="다시 시작할까요?" onClose={() => setPanel(null)}>
          <p>{currentStop.name}의 버스와 승객이 처음 위치로 돌아가요.</p>
          <div className="depot-menu">
            <button className="ocean" type="button" onClick={() => startLevel(view.level)}>
              처음부터 시작
            </button>
            <button type="button" onClick={() => setPanel(null)}>
              취소
            </button>
          </div>
        </Modal>
      )}
      {panel === 'stages' && (
        <Modal title="단계 선택" onClose={() => setPanel(null)}>
          <img className="depot-vignette" src={lighthouse} alt="" />
          <div className="depot-menu">
            {stops.map((stop, i) => {
              const unlocked =
                i === 0 || known[stops[i - 1].id]?.cleared || known[stop.id]?.cleared || view.level === i + 1;
              return (
                <button
                  key={stop.id}
                  type="button"
                  disabled={!unlocked || locked}
                  onClick={() => {
                    if (i + 1 === view.level && view.status === 'playing') setPanel(null);
                    else startLevel(i + 1);
                  }}
                >
                  <strong>{i + 1}단계</strong>
                  <span>{stop.name}</span>
                  {known[stop.id]?.cleared ? (
                    <Icon name="check" size={17} />
                  ) : (
                    !unlocked && <Icon name="lock" size={15} />
                  )}
                </button>
              );
            })}
            <button type="button" onClick={() => setPanel(null)}>
              닫기
            </button>
          </div>
        </Modal>
      )}
      {panel === 'settings' && (
        <div className="depot-settings">
          <SettingsScreen
            depot
            storage={storage}
            onHome={() => {
              const restored = openDepot(latest(), view.layout);
              session.current = restored;
              visible.current = visibleState(restored.game);
              setView(restored.game);
              setPanel(null);
            }}
          />
        </div>
      )}
      {result && (
        <Modal title={view.status === 'won' ? '모두 탔어요!' : '승강장이 꽉 찼어요'}>
          <img className="depot-vignette" src={view.status === 'won' ? garden : garage} alt="" />
          <p>
            {view.status === 'won'
              ? `${currentStop.name}에서 승객 ${view.totalPassengers}명을 모두 태웠어요.`
              : '대기 중인 버스에 탈 승객이 없어요. 출차 순서를 바꿔 보세요.'}
          </p>
          <div className="depot-menu">
            {view.status === 'won' ? (
              view.level < stops.length ? (
                <button type="button" className="ocean" onClick={() => startLevel(view.level + 1)}>
                  다음 단계
                </button>
              ) : (
                <button type="button" className="ocean" onClick={() => setPanel('stages')}>
                  단계 선택
                </button>
              )
            ) : (
              <button type="button" className="ocean" disabled={!canUndo} onClick={undo}>
                한 수 되돌리기
              </button>
            )}
            <button type="button" onClick={() => startLevel(view.level)}>
              다시 시작
            </button>
          </div>
        </Modal>
      )}
      <UpdateNotice playing={panel !== 'settings'} storage={storage} />
    </main>
  );
}

export default function DepotGame() {
  const storage = useSave();
  return storage.ready ? (
    <Play storage={storage} />
  ) : (
    <main className="depot-app depot-loading" aria-busy="true">
      정류장을 여는 중…
    </main>
  );
}

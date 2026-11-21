import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoundDefinition } from '../../content/round-schema';
import { applyMove, createInitialState, getGameOutcome, replay } from '../../game/domain/engine';
import type { GameState } from '../../game/domain/types';
import { feedback } from '../../game/render/feedback';
import { directionLabels, palette } from '../../game/render/palette';
import { boardLayout, GameScene } from '../../game/render/scene';
import type { Settings } from '../../storage/save-schema';
import { Icon } from '../icons';
import { Modal } from '../Modal';

export interface GameScreenProps {
  round: RoundDefinition;
  initialState: GameState;
  settings: Settings;
  locked: boolean;
  onState: (state: GameState) => void;
  onList: () => void;
  onNext: () => void;
  hasNext: boolean;
}
const rejectionMessages = {
  'blocked-path': '앞에 다른 버스가 있어요. 길을 먼저 열어주세요.',
  'platform-full': '플랫폼이 가득 찼어요. 다음 승객의 색을 확인해 보세요.',
  'not-parked': '',
  'round-finished': '',
};

export default function GameScreen({
  round,
  initialState,
  settings,
  locked,
  onState,
  onList,
  onNext,
  hasNext,
}: GameScreenProps) {
  const [state, setState] = useState(initialState);
  const game = useRef(initialState);
  const [epoch, setEpoch] = useState(0);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<'won' | 'lost' | null>(null);
  const [message, setMessage] = useState('버스를 눌러 화살표 방향으로 출발시켜 보세요.');
  const [error, setError] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<GameScene | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const settled = useCallback(() => {
    const outcome = getGameOutcome(game.current, round);
    if (outcome !== 'playing') setResult(outcome);
  }, [round]);

  useEffect(() => {
    // epoch intentionally remounts the visual state after restart / undo.
    void epoch;
    const instance = new GameScene(round, game.current, settingsRef.current, settled, setError);
    scene.current = instance;
    const mountedState = game.current;
    if (host.current)
      void instance
        .init(host.current)
        .then(() => {
          if (getGameOutcome(mountedState, round) !== 'playing') settled();
        })
        .catch(() =>
          setError('그래픽 화면을 열지 못했습니다. WebGL이 지원되는 브라우저에서 다시 시도해 주세요.'),
        );
    return () => {
      instance.destroy();
      if (scene.current === instance) scene.current = null;
    };
  }, [round, epoch, settled]);
  useEffect(() => {
    void epoch;
    scene.current?.configure(settings);
  }, [settings, epoch]);
  useEffect(() => {
    void epoch;
    scene.current?.setPaused(paused || locked);
  }, [paused, locked, epoch]);

  function dispatch(id: string) {
    if (paused || result || locked || getGameOutcome(game.current, round) !== 'playing') return;
    const transition = applyMove(game.current, { type: 'dispatch', vehicleId: id }, round);
    if (transition.rejection) {
      if (transition.rejection !== 'not-parked') {
        setMessage(rejectionMessages[transition.rejection]);
        void scene.current?.reject(id, transition.rejection);
        feedback(settings, false);
      }
      return;
    }
    game.current = transition.nextState;
    setState(transition.nextState);
    setMessage('좋아요! 다음 승객과 빈 플랫폼을 살펴보세요.');
    onState(transition.nextState);
    scene.current?.enqueue(transition);
    feedback(settings, true);
  }

  function reset(next = createInitialState(round)) {
    scene.current?.destroy();
    scene.current = null;
    game.current = next;
    setState(next);
    setResult(null);
    setPaused(false);
    setError('');
    setMessage('버스를 눌러 화살표 방향으로 출발시켜 보세요.');
    setEpoch((value) => value + 1);
    onState(next);
  }
  const { cell, left, top } = boardLayout(round);
  const remaining = round.passengers.length - state.passengerIndex;
  return (
    <main className="game-screen">
      <div className="game-title">
        <button type="button" className="icon-button" aria-label="라운드 목록으로" onClick={onList}>
          <Icon name="back" />
        </button>
        <div>
          <span>ROUND {String(Math.floor(round.order / 10)).padStart(2, '0')}</span>
          <h1>{round.title}</h1>
        </div>
        <button type="button" className="icon-button" aria-label="일시정지" onClick={() => setPaused(true)}>
          <Icon name="pause" />
        </button>
      </div>
      <div className="game-layout">
        <aside className="game-guide">
          <div className="guide-symbol">
            <Icon name="bus" size={35} />
          </div>
          <h2>
            한 대씩,
            <br />
            차근차근.
          </h2>
          <p>{round.description}</p>
          <div className="guide-rule">
            <span>01</span>
            <p>
              화살표 앞의 길이 비어야
              <br />
              버스가 출발할 수 있어요.
            </p>
          </div>
          <div className="guide-rule">
            <span>02</span>
            <p>
              맨 앞 승객과 같은 색의
              <br />
              버스부터 채워보세요.
            </p>
          </div>
          <div className="guide-rule">
            <span>03</span>
            <p>
              정원이 차면 자동 출발!
              <br />
              플랫폼이 다시 비워져요.
            </p>
          </div>
          <div className="guide-colors">
            {Object.entries(palette).map(([color, data]) => (
              <span key={color} style={{ color: data.hex }}>
                <b>{data.symbol}</b>
                {data.name}
              </span>
            ))}
          </div>
        </aside>
        <div className="game-center">
          <div className="game-stats">
            <span>
              남은 승객{' '}
              <strong>
                {remaining}
                <small>명</small>
              </strong>
            </span>
            <div className="passenger-progress">
              <span style={{ width: `${(state.passengerIndex / round.passengers.length) * 100}%` }} />
            </div>
            <span>
              주차된 버스{' '}
              <strong>
                {state.parkingVehicleIds.length}
                <small>대</small>
              </strong>
            </span>
          </div>
          <fieldset className="board-wrap" aria-label="주차장. 버스를 선택하면 화살표 방향으로 출발합니다.">
            <div className="pixi-host" ref={host} />
            <div className="vehicle-inputs">
              {round.vehicles
                .filter((v) => state.parkingVehicleIds.includes(v.id))
                .map((v) => {
                  const pose = state.vehiclePoseById[v.id];
                  return (
                    <button
                      type="button"
                      key={v.id}
                      className="vehicle-hit"
                      disabled={paused || locked || !!result}
                      style={{
                        left: `${((left + pose.col * cell) / 560) * 100}%`,
                        top: `${((top + pose.row * cell) / 630) * 100}%`,
                        width: `${(cell / 560) * 100}%`,
                        height: `${(cell / 630) * 100}%`,
                      }}
                      aria-label={`${palette[v.color].name} ${palette[v.color].symbol} 버스 ${v.id}, ${directionLabels[pose.direction]} 방향, ${v.capacity}인승`}
                      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
                      onPointerUp={(event) => {
                        if (event.button === 0) dispatch(v.id);
                      }}
                      onClick={(event) => {
                        if (event.detail === 0) dispatch(v.id);
                      }}
                    />
                  );
                })}
            </div>
            {error && (
              <div className="canvas-error" role="alert">
                <p>{error}</p>
                <button type="button" className="button secondary" onClick={() => reset(game.current)}>
                  화면 다시 열기
                </button>
              </div>
            )}
          </fieldset>
          <p className="game-message" aria-live="polite">
            {message}
          </p>
          <div className="game-controls">
            <button
              type="button"
              className="button secondary"
              disabled={!state.dispatchHistory.length || locked}
              onClick={() => reset(replay(round, game.current.dispatchHistory.slice(0, -1)))}
            >
              <Icon name="undo" size={18} />한 수 되돌리기
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={locked}
              onClick={() => setPaused(true)}
            >
              <Icon name="restart" size={18} />
              다시 시작
            </button>
          </div>
        </div>
        <aside className="queue-guide">
          <h2>기다리는 승객</h2>
          <p>왼쪽부터 차례대로 탑승해요.</p>
          <div className="queue-colors">
            {round.passengers
              .map((color, id) => ({ color, id }))
              .slice(state.passengerIndex)
              .map(({ color, id }) => (
                <span
                  key={id}
                  style={{ color: palette[color].hex }}
                  role="img"
                  aria-label={`${palette[color].name} 승객`}
                >
                  {palette[color].symbol}
                </span>
              ))}
          </div>
          <div className="calm-note">
            <Icon name="leaf" size={24} />
            <p>
              시간 제한은 없어요.
              <br />
              천천히 살펴보세요.
            </p>
          </div>
        </aside>
      </div>
      {paused && (
        <Modal title="잠깐 쉬어갈까요?" onClose={() => setPaused(false)}>
          <p>진행 상황은 자동으로 저장됩니다.</p>
          <div className="modal-actions">
            <button type="button" className="button primary" onClick={() => setPaused(false)}>
              계속하기
            </button>
            <button type="button" className="button secondary" disabled={locked} onClick={() => reset()}>
              라운드 다시 시작
            </button>
            <button type="button" className="text-button" onClick={onList}>
              라운드 목록으로
            </button>
          </div>
        </Modal>
      )}
      {result && !paused && (
        <Modal title={result === 'won' ? '모두 탔어요. 출발!' : '잠깐, 길이 막혔어요.'}>
          <div className={`result-symbol ${result}`}>
            <Icon name={result === 'won' ? 'flag' : 'bus'} size={45} />
          </div>
          <p>
            {result === 'won'
              ? '모든 승객과 버스를 보냈어요. 잘하셨어요!'
              : '다음 승객을 태울 수 없어요. 출차 순서를 바꿔볼까요?'}
          </p>
          <div className="modal-actions">
            {result === 'won' ? (
              <button type="button" className="button primary" onClick={onNext}>
                {hasNext ? '다음 라운드' : '라운드 목록으로'}
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                disabled={locked}
                onClick={() => reset(replay(round, game.current.dispatchHistory.slice(0, -1)))}
              >
                한 수 되돌리기
              </button>
            )}
            <button type="button" className="button secondary" disabled={locked} onClick={() => reset()}>
              다시 플레이
            </button>
            {hasNext && (
              <button type="button" className="text-button" onClick={onList}>
                라운드 목록으로
              </button>
            )}
          </div>
        </Modal>
      )}
    </main>
  );
}

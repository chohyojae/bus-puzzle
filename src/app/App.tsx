import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { rounds } from '../content/rounds/catalog';
import { createInitialState, getGameOutcome } from '../game/domain/engine';
import type { GameState } from '../game/domain/types';
import { UpdateNotice } from '../pwa/UpdateNotice';
import { downloadBackup } from '../storage/import-export';
import { getResumeProblem, isUnlocked } from '../storage/save-schema';
import { useSave } from '../storage/use-save';
import { Icon } from './icons';
import { Modal } from './Modal';
import { HomeScreen } from './screens/HomeScreen';
import { RoundListScreen } from './screens/RoundListScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const GameScreen = lazy(() => import('./screens/GameScreen'));
type Route = { screen: 'home' | 'rounds' | 'settings' } | { screen: 'game'; roundId: string };

export default function App() {
  const storage = useSave();
  const { save, mutate, latest, locked } = storage;
  const [route, setRoute] = useState<Route>({ screen: 'home' });
  const [session, setSession] = useState(0);
  const initialGame = useRef<GameState | null>(null);
  const [resumeProblem, setResumeProblem] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const headingFocus = useRef<HTMLDivElement>(null);
  const navigate = useCallback((next: Route) => {
    history.pushState(next, '', location.href);
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    history.replaceState({ screen: 'home' }, '', location.href);
    const pop = () => {
      const state = history.state as Route | null;
      setRoute(state?.screen === 'game' ? { screen: 'rounds' } : (state ?? { screen: 'home' }));
    };
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('popstate', pop);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);
  useEffect(() => {
    void route;
    headingFocus.current?.focus({ preventScroll: true });
  }, [route]);

  function play(id: string, resume = false) {
    const round = rounds.find((r) => r.id === id);
    if (!round || !isUnlocked(round, latest()) || locked) {
      navigate({ screen: 'settings' });
      return;
    }
    const run = latest().activeRun;
    const state = resume && run?.roundId === id ? run.gameState : createInitialState(round);
    initialGame.current = state;
    mutate((previous) => ({
      ...previous,
      activeRun: {
        roundId: id,
        roundRevision: round.revision,
        gameState: state,
        updatedAt: new Date().toISOString(),
      },
    }));
    setSession((value) => value + 1);
    navigate({ screen: 'game', roundId: id });
    if ('storage' in navigator) void navigator.storage.persist?.().catch(() => undefined);
  }
  function resume() {
    const run = latest().activeRun;
    if (!run) return;
    const problem = getResumeProblem(run, rounds);
    if (problem) setResumeProblem(problem);
    else play(run.roundId, true);
  }
  const round = route.screen === 'game' ? rounds.find((r) => r.id === route.roundId) : undefined;
  function saveGame(state: GameState) {
    if (!round) return;
    const now = new Date().toISOString();
    mutate((previous) => {
      if (getGameOutcome(state, round) !== 'won')
        return {
          ...previous,
          activeRun: { roundId: round.id, roundRevision: round.revision, gameState: state, updatedAt: now },
        };
      const old = previous.roundProgressById[round.id];
      return {
        ...previous,
        activeRun: null,
        roundProgressById: {
          ...previous.roundProgressById,
          [round.id]: {
            cleared: true,
            firstClearedAt: old?.firstClearedAt ?? now,
            lastClearedAt: now,
            clearCount: (old?.clearCount ?? 0) + 1,
            clearedRevision: round.revision,
          },
        },
      };
    });
  }
  const roundIndex = round ? rounds.indexOf(round) : -1;
  const nextRound = rounds.slice(roundIndex + 1).find((r) => isUnlocked(r, save));
  const reminder =
    !save.backupReminderDismissed &&
    Object.values(save.roundProgressById).filter((p) => p.cleared).length >= 3;
  if (!storage.ready)
    return (
      <div className="loading-screen">
        <Icon name="bus" size={48} />
        <p>출발을 준비하고 있어요.</p>
      </div>
    );
  return (
    <div className={`app-shell ${save.settings.reducedMotion ? 'reduced-motion' : ''}`}>
      <header className="site-header">
        <button
          type="button"
          className="brand"
          aria-label="Bus Puzzle 홈"
          onClick={() => navigate({ screen: 'home' })}
        >
          <Icon name="bus" size={38} />
          <span>BUS PUZZLE</span>
        </button>
        <div className="header-tools">
          <span className="connection-state">{online ? '나만의 작은 정류장' : '오프라인 플레이'}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={save.settings.soundEnabled ? '효과음 끄기' : '효과음 켜기'}
            disabled={locked}
            onClick={() =>
              mutate((previous) => ({
                ...previous,
                settings: { ...previous.settings, soundEnabled: !previous.settings.soundEnabled },
              }))
            }
          >
            <Icon name={save.settings.soundEnabled ? 'sound' : 'muted'} />
          </button>
          <span className="header-divider" />
          <button
            type="button"
            className="icon-button"
            aria-label="설정 열기"
            onClick={() => navigate({ screen: 'settings' })}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      <div ref={headingFocus} tabIndex={-1} className="screen-focus" />
      {storage.warning && (
        <div className="storage-warning" role="alert">
          <span>{storage.warning}</span>
          <button type="button" onClick={() => navigate({ screen: 'settings' })}>
            백업 및 복구
          </button>
        </div>
      )}
      {route.screen === 'home' && (
        <HomeScreen
          onStart={() => navigate({ screen: 'rounds' })}
          onSettings={() => navigate({ screen: 'settings' })}
          onResume={resume}
          activeRun={save.activeRun}
        />
      )}
      {route.screen === 'rounds' && (
        <RoundListScreen save={save} onPlay={(id) => play(id)} onHome={() => navigate({ screen: 'home' })} />
      )}
      {route.screen === 'settings' && (
        <SettingsScreen storage={storage} onHome={() => navigate({ screen: 'home' })} />
      )}
      {route.screen === 'game' && round && initialGame.current && (
        <Suspense
          fallback={
            <div className="loading-screen">
              <Icon name="bus" size={40} />
              <p>주차장을 준비하고 있어요.</p>
            </div>
          }
        >
          <GameScreen
            key={`${round.id}-${session}`}
            round={round}
            initialState={initialGame.current}
            settings={save.settings}
            locked={locked}
            onState={saveGame}
            onList={() => navigate({ screen: 'rounds' })}
            onNext={() => (nextRound ? play(nextRound.id) : navigate({ screen: 'rounds' }))}
            hasNext={!!nextRound}
          />
        </Suspense>
      )}
      <footer className="site-footer">
        <span>나만의 속도로, 한 라운드씩.</span>
        <span>
          <Icon name="save" size={17} />
          {storage.warning ? '백업이 필요해요' : '기기에 자동 저장'}
        </span>
      </footer>
      <UpdateNotice playing={route.screen === 'game'} storage={storage} />
      {resumeProblem && (
        <Modal title="진행 기록을 확인해 주세요" onClose={() => setResumeProblem('')}>
          <p>{resumeProblem}</p>
          <div className="modal-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => {
                setResumeProblem('');
                navigate({ screen: 'rounds' });
              }}
            >
              라운드 목록으로
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={async () => {
                try {
                  await downloadBackup(latest());
                } catch (error) {
                  setResumeProblem(
                    error instanceof Error ? error.message : '백업 파일을 저장하지 못했습니다.',
                  );
                }
              }}
            >
              현재 기록 내보내기
            </button>
            <button type="button" className="text-button" onClick={() => setResumeProblem('')}>
              닫기
            </button>
          </div>
        </Modal>
      )}
      {reminder && route.screen !== 'game' && (
        <div className="backup-reminder" role="status">
          <span>세 라운드를 완료했어요! 기록을 파일로 보관해 보세요.</span>
          <button
            type="button"
            onClick={() => {
              mutate((previous) => ({ ...previous, backupReminderDismissed: true }));
              navigate({ screen: 'settings' });
            }}
          >
            백업하기
          </button>
          <button
            type="button"
            aria-label="백업 안내 닫기"
            onClick={() => mutate((previous) => ({ ...previous, backupReminderDismissed: true }))}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      )}
    </div>
  );
}

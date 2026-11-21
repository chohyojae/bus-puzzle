import { useCallback, useEffect, useRef, useState } from 'react';
import { required } from '../required';
import { SaveConflictError, SaveRepository } from './save-repository';
import { createEmptySave, type SaveData } from './save-schema';

export function useSave() {
  const initial = useRef(createEmptySave(window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  const [save, setSave] = useState(initial.current);
  const current = useRef(save);
  const [ready, setReady] = useState(false);
  const [warning, setWarning] = useState('');
  const [locked, setLocked] = useState(false);
  const [rawRecovery, setRawRecovery] = useState<unknown>();
  const repository = useRef<SaveRepository | null>(null);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const failed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const repo = new SaveRepository();
    repository.current = repo;
    repo.onExternalChange = () => {
      if (!cancelled) {
        failed.current = true;
        setLocked(true);
        setWarning('다른 창에서 기록이 바뀌었습니다. 이 창의 기록을 백업한 뒤 새로고침해 주세요.');
      }
    };
    repo
      .load(initial.current.settings.reducedMotion)
      .then((data) => {
        if (!cancelled) {
          current.current = data;
          setSave(data);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          failed.current = true;
          setWarning(
            error instanceof Error ? error.message : '저장소를 열지 못했습니다. 기록은 이 창에만 유지됩니다.',
          );
          if (repo.rawRecovery !== undefined) {
            setLocked(true);
            setRawRecovery(repo.rawRecovery);
          }
        }
      })
      .finally(() => {
        if (cancelled) repo.close();
        else setReady(true);
      });
    return () => {
      cancelled = true;
      repo.close();
    };
  }, []);

  const mutate = useCallback((update: (previous: SaveData) => SaveData) => {
    const next = update(current.current);
    current.current = next;
    setSave(next);
    repository.current?.stage(next);
    if (!failed.current) {
      pending.current = pending.current.then(() => required(repository.current).write(next));
      void pending.current.catch((error: unknown) => {
        failed.current = true;
        setWarning(
          error instanceof Error ? error.message : '저장에 실패했습니다. 현재 기록을 내보내 주세요.',
        );
        if (error instanceof SaveConflictError) setLocked(true);
      });
    }
  }, []);

  const replace = useCallback(async (next: SaveData, recovery = false) => {
    if (!repository.current) throw new Error('저장소가 준비되지 않았습니다.');
    if (recovery) await repository.current.recover(next);
    else {
      await pending.current;
      await repository.current.write(next);
    }
    current.current = next;
    setSave(next);
    pending.current = Promise.resolve();
    failed.current = false;
    setLocked(false);
    setRawRecovery(undefined);
    setWarning('');
  }, []);
  const flush = useCallback(async () => {
    await pending.current;
  }, []);
  const latest = useCallback(() => current.current, []);
  return { save, ready, warning, locked, rawRecovery, mutate, replace, flush, latest };
}
export type SaveController = ReturnType<typeof useSave>;

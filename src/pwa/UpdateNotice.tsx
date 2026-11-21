import { useRegisterSW } from 'virtual:pwa-register/react';
import { useState } from 'react';
import type { SaveController } from '../storage/use-save';
export function UpdateNotice({ playing, storage }: { playing: boolean; storage: SaveController }) {
  const [error, setError] = useState('');
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  if (playing || (!needRefresh && !offlineReady && !error)) return null;
  return (
    <div className="pwa-notice" role="status">
      <span>
        {error ||
          (needRefresh ? '새로운 버전이 준비됐어요.' : '오프라인 준비 완료. 인터넷 없이도 즐겨보세요.')}
      </span>
      {needRefresh && (
        <button
          type="button"
          onClick={async () => {
            try {
              await storage.flush();
              await updateServiceWorker(true);
            } catch {
              setError('저장 확인에 실패했습니다. 기록을 백업한 후 다시 시도해 주세요.');
            }
          }}
        >
          업데이트
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setNeedRefresh(false);
          setOfflineReady(false);
          setError('');
        }}
      >
        나중에
      </button>
    </div>
  );
}

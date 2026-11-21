import type { ChangeEvent } from 'react';
import { useId, useState } from 'react';
import { rounds } from '../../content/rounds/catalog';
import { stops } from '../../game/depot/stages';
import {
  downloadBackup,
  downloadRecoveryBackup,
  importPreview,
  mergeSaves,
  readBackupFile,
} from '../../storage/import-export';
import { createEmptySave, getResumeProblem, type SaveData, type Settings } from '../../storage/save-schema';
import type { SaveController } from '../../storage/use-save';
import { Icon } from '../icons';
import { Modal } from '../Modal';

function SettingToggle({
  title,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <label className={`setting-row ${disabled ? 'disabled' : ''}`}>
      <span>
        <strong id={`${id}-name`}>{title}</strong>
        <small id={`${id}-description`}>{description}</small>
      </span>
      <input
        type="checkbox"
        className="toggle-input"
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-description`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

export function SettingsScreen({
  storage,
  onHome,
  depot = false,
}: {
  storage: SaveController;
  onHome: () => void;
  depot?: boolean;
}) {
  const { save, mutate, locked } = storage;
  const [incoming, setIncoming] = useState<SaveData | null>(null);
  const [includeSettings, setIncludeSettings] = useState(false);
  const [includeActive, setIncludeActive] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [recoverConfirmed, setRecoverConfirmed] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    mutate((previous) => ({ ...previous, settings: { ...previous.settings, [key]: value } }));
  const hapticsSupported = typeof navigator.vibrate === 'function';
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const data = await readBackupFile(file);
      setIncoming(data);
      setIncludeSettings(false);
      setIncludeActive(false);
      setReplaceConfirmed(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '파일을 읽지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(source: 'save' | 'recovery' = 'save') {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      if (source === 'recovery') await downloadRecoveryBackup(storage.rawRecovery);
      else await downloadBackup(storage.latest());
      setStatus('백업 파일을 내보냈습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '백업 파일을 내보내지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  async function applyImport(mode: 'merge' | 'replace') {
    if (!incoming) return;
    setBusy(true);
    try {
      const next =
        mode === 'replace'
          ? incoming
          : mergeSaves(storage.latest(), incoming, { settings: includeSettings, activeRun: includeActive });
      await storage.replace(next);
      setIncoming(null);
      setStatus(mode === 'merge' ? '백업 기록을 병합했습니다.' : '백업으로 교체했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '저장에 실패하여 기존 데이터는 유지되었습니다.');
    } finally {
      setBusy(false);
    }
  }
  const preview = incoming ? importPreview(save, incoming) : null;
  const unknown = incoming
    ? Object.keys(incoming.roundProgressById).filter(
        (id) => !rounds.some((r) => r.id === id) && !stops.some((r) => r.id === id),
      ).length
    : 0;
  return (
    <main className="content-screen settings-screen">
      <button type="button" className="text-button" onClick={onHome}>
        <Icon name="back" size={18} />
        {depot ? '게임으로' : '홈으로'}
      </button>
      <div className="screen-heading">
        <div>
          <h1>설정</h1>
        </div>
        <Icon name="settings" size={34} />
      </div>
      <div className="settings-layout">
        <section className="settings-panel" aria-labelledby="play-settings">
          <h2 id="play-settings">플레이 설정</h2>
          <SettingToggle
            title="효과음"
            description="효과음 재생 여부"
            checked={save.settings.soundEnabled}
            disabled={locked}
            onChange={(value) => setSetting('soundEnabled', value)}
          />
          <SettingToggle
            title="진동"
            description="터치 시 진동 사용 여부"
            checked={save.settings.hapticsEnabled}
            disabled={locked || !hapticsSupported}
            onChange={(value) => setSetting('hapticsEnabled', value)}
          />
          <label className="setting-row">
            <span>
              <strong>프레임 레이트</strong>
              <small>게임 화면의 초당 프레임 수</small>
            </span>
            <select
              aria-label="프레임 레이트"
              value={save.settings.frameRate}
              disabled={locked}
              onChange={(event) =>
                setSetting('frameRate', Number(event.target.value) as Settings['frameRate'])
              }
            >
              <option value="60">60FPS</option>
              <option value="90">90FPS</option>
              <option value="120">120FPS</option>
            </select>
          </label>
        </section>
        <section className="settings-panel backup-panel" aria-labelledby="backup-settings">
          <div className="backup-icon">
            <Icon name="save" size={28} />
          </div>
          <h2 id="backup-settings">백업 및 데이터 이동</h2>
          <p>필요 시 데이터 백업 및 이동 가능</p>
          <div className="backup-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void exportFile()}
            >
              <Icon name="download" size={19} />
              저장 데이터 내보내기
            </button>
            <label className={`button secondary file-button ${locked || busy ? 'disabled' : ''}`}>
              <Icon name="upload" size={19} />
              저장 데이터 가져오기
              <input
                type="file"
                accept=".bpz,.json,application/zstd,application/gzip,application/json"
                onChange={readFile}
                disabled={locked || busy}
                aria-label="저장 데이터 가져오기"
              />
            </label>
          </div>
        </section>
      </div>
      <p className="settings-status" role="status">
        {!incoming && status}
      </p>
      {storage.rawRecovery !== undefined && (
        <section className="recovery-panel">
          <h2>저장 데이터 복구</h2>
          <p>저장 데이터를 읽을 수 없습니다. 새 기록을 시작하려면 먼저 원본을 내보내세요.</p>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void exportFile('recovery')}
          >
            원본 데이터 내보내기
          </button>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={recoverConfirmed}
              onChange={(event) => setRecoverConfirmed(event.target.checked)}
            />
            원본을 백업했으며, 새 기록으로 시작하겠습니다.
          </label>
          <button
            type="button"
            className="button danger"
            disabled={!recoverConfirmed || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await storage.replace(createEmptySave(), true);
                setStatus('새 기록을 만들었습니다.');
              } catch (error) {
                setStatus(error instanceof Error ? error.message : '복구에 실패했습니다.');
              } finally {
                setBusy(false);
              }
            }}
          >
            새 기록으로 복구
          </button>
        </section>
      )}
      <section className="about-panel">
        <div>
          <Icon name="leaf" size={22} />
          <h2>앱 정보</h2>
        </div>
        <p>기록은 이 브라우저에 저장됩니다. 브라우저 데이터를 삭제하면 기록도 함께 삭제됩니다.</p>
        <p>오프라인 준비가 끝나면 인터넷 연결 없이 플레이할 수 있습니다.</p>
        <small>Bus Puzzle v1.0.0</small>
      </section>
      {incoming && preview && (
        <Modal title="백업 확인" onClose={() => !busy && setIncoming(null)}>
          <div className="import-stats">
            <span>
              <strong>{preview.cleared}</strong>클리어 기록
            </span>
            <span>
              <strong>{preview.added}</strong>새로운 기록
            </span>
            <span>
              <strong>{preview.conflicts}</strong>변경된 기록
            </span>
          </div>
          {unknown > 0 && <p>현재 버전에 없는 라운드 {unknown}개의 기록도 보관합니다.</p>}
          {incoming.activeRun && (
            <p>{getResumeProblem(incoming.activeRun, rounds) ?? '진행 중인 라운드가 있습니다.'}</p>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeSettings}
              onChange={(event) => setIncludeSettings(event.target.checked)}
            />
            설정 가져오기
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeActive}
              onChange={(event) => setIncludeActive(event.target.checked)}
              disabled={!incoming.activeRun && !incoming.depotRun && !incoming.promenadeRun}
            />
            진행 중 라운드 가져오기
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void applyImport('merge')}
            >
              기록 병합
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void exportFile()}
            >
              현재 기록 백업
            </button>
          </div>
          {status && <p role="status">{status}</p>}
          <div className="replace-zone">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={replaceConfirmed}
                onChange={(event) => setReplaceConfirmed(event.target.checked)}
              />
              기존 설정과 모든 기록이 교체되는 것을 확인했습니다.
            </label>
            <button
              type="button"
              className="button danger"
              disabled={!replaceConfirmed || busy}
              onClick={() => void applyImport('replace')}
            >
              백업으로 완전히 교체
            </button>
          </div>
          <button type="button" className="text-button" disabled={busy} onClick={() => setIncoming(null)}>
            취소
          </button>
        </Modal>
      )}
    </main>
  );
}

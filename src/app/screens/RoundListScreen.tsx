import { roundDecoration, rounds } from '../../content/rounds/catalog';
import { isUnlocked, type SaveData } from '../../storage/save-schema';
import { Icon } from '../icons';

const difficulty = { easy: '가볍게 시작', medium: '한 번 더 생각', hard: '차근차근 도전' };
export function RoundListScreen({
  save,
  onPlay,
  onHome,
}: {
  save: SaveData;
  onPlay: (id: string) => void;
  onHome: () => void;
}) {
  const cleared = rounds.filter((r) => save.roundProgressById[r.id]?.cleared).length;
  return (
    <main className="content-screen round-list">
      <button type="button" className="text-button" onClick={onHome}>
        <Icon name="back" size={18} />
        홈으로
      </button>
      <div className="screen-heading">
        <div>
          <h1>어디로 출발할까요?</h1>
          <p>한 라운드씩, 나만의 속도로.</p>
        </div>
        <div className="progress-summary">
          <Icon name="flag" />
          <span>
            <strong>{cleared}</strong> / {rounds.length} 완료
          </span>
        </div>
      </div>
      <div className="round-grid">
        {rounds.map((round, index) => {
          const unlocked = isUnlocked(round, save),
            complete = !!save.roundProgressById[round.id]?.cleared;
          return (
            <article className={`round-card ${unlocked ? '' : 'locked'}`} key={round.id}>
              <div className="round-card-art">
                <img src={roundDecoration(round.id)} width="240" height="150" alt="" />
                {complete ? (
                  <span className="round-badge completed">
                    <Icon name="check" size={15} />
                    클리어
                  </span>
                ) : !unlocked ? (
                  <span className="round-badge">
                    <Icon name="lock" size={14} />
                    잠김
                  </span>
                ) : (
                  <span className="round-badge">플레이 가능</span>
                )}
              </div>
              <div className="round-card-body">
                <span className="round-number">
                  ROUND {String(index + 1).padStart(2, '0')}
                  <span>{difficulty[round.difficulty]}</span>
                </span>
                <h2>{round.title}</h2>
                <p>{round.description}</p>
                <div className="round-meta">
                  <span>{round.vehicles.length}대의 버스</span>
                  <span>플랫폼 {round.platformSlotCount}칸</span>
                </div>
                <button
                  type="button"
                  className={`button ${unlocked ? 'primary' : 'secondary'}`}
                  disabled={!unlocked}
                  onClick={() => onPlay(round.id)}
                >
                  {complete ? '다시 플레이' : unlocked ? '플레이' : '이전 라운드를 클리어해 주세요'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="list-footnote">
        <Icon name="save" size={17} />
        완료한 라운드는 언제든 다시 플레이할 수 있어요.
      </p>
    </main>
  );
}

import hero from '../../content/shared-assets/home-board.svg';
import { palette } from '../../game/render/palette';
import type { ActiveRun } from '../../storage/save-schema';
import { Icon } from '../icons';

export function HomeScreen({
  onStart,
  onSettings,
  onResume,
  activeRun,
}: {
  onStart: () => void;
  onSettings: () => void;
  onResume: () => void;
  activeRun: ActiveRun | null;
}) {
  return (
    <main className="home-screen">
      <div className="home-copy">
        <div className="route-art" aria-hidden="true">
          <span className="route-pin" />
          <span className="route-dashes" />
          <Icon name="bus" size={40} />
          <span className="route-dashes" />
          <Icon name="flag" size={30} />
        </div>
        <h1>
          작은 버스,
          <br />
          <span>즐거운 출발.</span>
        </h1>
        <p className="home-description">
          같은 색 승객을 태우고
          <br />
          복잡한 주차장을 비워보세요.
        </p>
        <div className="home-actions">
          <button type="button" className="button primary large" onClick={onStart}>
            시작하기
          </button>
          <button type="button" className="button secondary large" onClick={onSettings}>
            설정
          </button>
        </div>
        {activeRun && (
          <button type="button" className="resume-link" onClick={onResume}>
            <Icon name="play" size={17} />
            하던 라운드 이어하기
          </button>
        )}
        <div className="home-note">
          <span className="color-people" aria-hidden="true">
            {(['red', 'green', 'blue'] as const).map((color) => (
              <span key={color} style={{ backgroundColor: palette[color].hex }}>
                {palette[color].symbol}
              </span>
            ))}
          </span>
          <span>서두르지 않아도 괜찮아요.</span>
        </div>
      </div>
      <div className="home-art">
        <img
          src={hero}
          alt="알록달록한 버스와 승객이 기다리는 주차장"
          width="760"
          height="760"
          draggable="false"
        />
      </div>
    </main>
  );
}

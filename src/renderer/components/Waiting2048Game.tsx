import { Button } from "../ui";
import { RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useT } from "../i18n";
import { moveWaiting2048Game, startWaiting2048Game, type Waiting2048Direction, type Waiting2048GameState } from "../waiting2048Engine";
import { loadWaiting2048BestScore, saveWaiting2048BestScore } from "../waiting2048Storage";

export type { Waiting2048Direction, Waiting2048GameState };

export interface Waiting2048Engine {
  startGame: () => Waiting2048GameState;
  move: (direction: Waiting2048Direction, game: Waiting2048GameState) => Waiting2048GameState;
}

const defaultEngine: Waiting2048Engine = {
  startGame: () => startWaiting2048Game(),
  move: (direction, game) => moveWaiting2048Game(direction, game),
};

const KEY_DIRECTIONS: Record<string, Waiting2048Direction | undefined> = {
  ArrowUp: "UP",
  w: "UP",
  W: "UP",
  ArrowDown: "DOWN",
  s: "DOWN",
  S: "DOWN",
  ArrowLeft: "LEFT",
  a: "LEFT",
  A: "LEFT",
  ArrowRight: "RIGHT",
  d: "RIGHT",
  D: "RIGHT",
};

const DIRECTION_LABEL_KEYS: Record<Waiting2048Direction, string> = {
  UP: "dialogue.waiting2048.moveUp",
  DOWN: "dialogue.waiting2048.moveDown",
  LEFT: "dialogue.waiting2048.moveLeft",
  RIGHT: "dialogue.waiting2048.moveRight",
};

const DIRECTION_GLYPHS: Record<Waiting2048Direction, string> = {
  UP: "↑",
  DOWN: "↓",
  LEFT: "←",
  RIGHT: "→",
};

export function Waiting2048Game({ engine = defaultEngine }: { engine?: Waiting2048Engine }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [game, setGame] = useState<Waiting2048GameState>(() => engine.startGame());
  const [bestScore, setBestScore] = useState(() => loadWaiting2048BestScore());
  const score = game.score;
  const boardLabel = t("dialogue.waiting2048.boardLabel");
  const isGameOver = game.gameStatus === "GAME_OVER";
  const isWon = game.gameStatus === "WON";

  useEffect(() => {
    setBestScore((current) => Math.max(current, loadWaiting2048BestScore()));
  }, []);

  useEffect(() => {
    if (score <= 0) return;
    setBestScore(saveWaiting2048BestScore(score));
  }, [score]);

  const restart = useCallback(() => {
    setGame(engine.startGame());
  }, [engine]);

  const applyMove = useCallback((direction: Waiting2048Direction) => {
    setGame((current) => current.gameStatus === "GAME_OVER" ? current : engine.move(direction, current));
  }, [engine]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const direction = KEY_DIRECTIONS[event.key];
    if (!direction) return;
    event.preventDefault();
    applyMove(direction);
  }, [applyMove]);

  const tiles = useMemo(() => game.board.flat(), [game.board]);

  if (!expanded) {
    return (
      <div className="waiting-2048 waiting-2048-collapsed">
        <div>
          <strong>{t("dialogue.waiting2048.title")}</strong>
          <span>{t("dialogue.waiting2048.collapsedHint")}</span>
        </div>
        <Button size="small" onClick={() => setExpanded(true)}>
          {t("dialogue.waiting2048.play")}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="waiting-2048 waiting-2048-expanded"
      role="region"
      aria-label={t("dialogue.waiting2048.regionLabel")}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="waiting-2048-header">
        <div>
          <strong>{t("dialogue.waiting2048.title")}</strong>
          <span>{t("dialogue.waiting2048.instructions")}</span>
        </div>
        <div className="waiting-2048-actions">
          <Button size="small" icon={<RotateCcw size={14} />} onClick={restart}>
            {t("dialogue.waiting2048.restart")}
          </Button>
          <Button size="small" icon={<X size={14} />} onClick={() => setExpanded(false)}>
            {t("dialogue.waiting2048.collapse")}
          </Button>
        </div>
      </div>
      <div className="waiting-2048-score-row">
        <ScoreBox label={t("dialogue.waiting2048.score")} value={score} />
        <ScoreBox label={t("dialogue.waiting2048.best")} value={bestScore} />
        {isGameOver ? <div className="waiting-2048-state">{t("dialogue.waiting2048.gameOver")}</div> : null}
        {isWon ? <div className="waiting-2048-state">{t("dialogue.waiting2048.won")}</div> : null}
      </div>
      <div className="waiting-2048-board" role="grid" aria-label={boardLabel}>
        {tiles.map((value, index) => (
          <div
            key={`${index}-${value}`}
            className={`waiting-2048-tile waiting-2048-tile-${Math.min(value, 2048) || "empty"}`}
            role="gridcell"
            aria-label={value ? String(value) : t("dialogue.waiting2048.emptyCell")}
          >
            {value || ""}
          </div>
        ))}
      </div>
      <div className="waiting-2048-controls" aria-label={t("dialogue.waiting2048.controlsLabel")}>
        {(["UP", "LEFT", "DOWN", "RIGHT"] as Waiting2048Direction[]).map((direction) => (
          <button
            key={direction}
            type="button"
            className={`waiting-2048-control waiting-2048-control-${direction.toLowerCase()}`}
            aria-label={t(DIRECTION_LABEL_KEYS[direction])}
            onClick={() => applyMove(direction)}
          >
            {DIRECTION_GLYPHS[direction]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ScoreBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="waiting-2048-score">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

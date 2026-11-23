import { useChessGame } from './game/useChessGame';
import { Scene3D } from './components/Scene3D';
import { GameHUD } from './components/GameHUD';

export function App() {
  const {
    hasStarted,
    gameMode,
    difficulty,
    pieces,
    capturedPieces,
    status,
    selectedSquare,
    legalTargets,
    lastMove,
    pendingPromotion,
    activeAnimation,
    isAnimating,
    isAiThinking,
    isHumanTurn,
    isCheckmateSequenceActive,
    checkmateTitleVisible,
    setGameMode,
    setDifficulty,
    startGame,
    selectOrMoveSquare,
    executeVoiceCommand,
    confirmPromotion,
    cancelPromotion,
    completeAnimation,
    completeCheckmateSequence,
    resetGame,
    returnToMenu,
  } = useChessGame();

  return (
    <main className="relative h-full w-full overflow-hidden bg-[#080c14]">
      <Scene3D
        hasStarted={hasStarted}
        pieces={pieces}
        status={status}
        selectedSquare={selectedSquare}
        legalTargets={legalTargets}
        lastMove={lastMove}
        activeAnimation={activeAnimation}
        isAnimating={isAnimating}
        isHumanTurn={isHumanTurn}
        isAiThinking={isAiThinking}
        isCheckmateSequenceActive={isCheckmateSequenceActive}
        onSelectSquare={selectOrMoveSquare}
        onAnimationComplete={completeAnimation}
        onCheckmateSequenceComplete={completeCheckmateSequence}
      />
      <GameHUD
        hasStarted={hasStarted}
        gameMode={gameMode}
        difficulty={difficulty}
        status={status}
        capturedPieces={capturedPieces}
        pendingPromotion={pendingPromotion}
        isAiThinking={isAiThinking}
        isHumanTurn={isHumanTurn}
        isAnimating={isAnimating}
        checkmateTitleVisible={checkmateTitleVisible}
        onSelectMode={setGameMode}
        onSelectDifficulty={setDifficulty}
        onStartGame={startGame}
        onConfirmPromotion={confirmPromotion}
        onCancelPromotion={cancelPromotion}
        onVoiceCommand={executeVoiceCommand}
        onResetGame={resetGame}
        onReturnToMenu={returnToMenu}
      />
    </main>
  );
}

export default App;

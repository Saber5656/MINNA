import { parseRoomCode } from './minna.ts';

export function incomingRoomDecision(
  incomingUrl: string | null,
  consumedUrl: string | null,
  currentRoom: string | null,
) {
  if (!incomingUrl || incomingUrl === consumedUrl) {
    return { action: 'ignore' as const, consumedUrl, roomCode: null };
  }
  const roomCode = parseRoomCode(incomingUrl);
  if (!roomCode || roomCode === currentRoom) {
    return { action: 'ignore' as const, consumedUrl: incomingUrl, roomCode };
  }
  return {
    action: currentRoom ? 'confirm' as const : 'activate' as const,
    consumedUrl: incomingUrl,
    roomCode,
  };
}

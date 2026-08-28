<?php

declare(strict_types=1);

namespace HoverRace\Server;

final class Api
{
    private const LOBBY = 'lobby';
    private const CAPACITY = 9;
    private const PRESENCE_TTL_MS = 15_000;
    private const WAITING_PLAYER_TTL_MS = 20_000;
    private const RACE_PLAYER_TTL_MS = 12_000;
    private const START_DELAY_MS = 6_000;
    private const CUSTOM_TRACK_BYTES = 4_000_000;

    public function __construct(private readonly JsonStore $store)
    {
    }

    public function dispatch(string $method, string $path): void
    {
        if ($method === 'OPTIONS') {
            http_response_code(204);
            return;
        }

        try {
            $response = match ([$method, $path]) {
                ['GET', '/api/status'] => $this->status(),
                ['GET', '/api/rooms'] => $this->rooms(),
                ['POST', '/api/presence'] => $this->presence($this->body()),
                ['GET', '/api/chat'] => $this->chat(),
                ['POST', '/api/chat'] => $this->sendChat($this->body()),
                ['POST', '/api/rooms'] => $this->createRoom($this->body()),
                ['POST', '/api/race/join'] => $this->joinRace($this->body()),
                ['POST', '/api/race/start'] => $this->startRace($this->body()),
                ['POST', '/api/race/leave'] => $this->leaveRace($this->body()),
                ['GET', '/api/race/state'] => $this->raceState(),
                ['POST', '/api/race/state'] => $this->publishRaceState($this->body()),
                default => throw new HttpException(404, 'Endpoint not found'),
            };
            $this->json($response);
        } catch (HttpException $exception) {
            $this->json(['error' => $exception->getMessage()], $exception->status);
        } catch (\JsonException) {
            $this->json(['error' => 'Malformed JSON request'], 400);
        } catch (\Throwable $exception) {
            error_log((string) $exception);
            $this->json(['error' => 'Server error'], 500);
        }
    }

    /** @return array<string, mixed> */
    private function status(): array
    {
        return ['service' => 'HoverRace PHP backend', 'status' => 'ok', 'protocol' => 2, 'time' => time()];
    }

    /** @return array<string, mixed> */
    private function rooms(): array
    {
        $now = $this->now();
        $games = [];
        foreach ($this->store->read('rooms') as $room) {
            if (!is_array($room) || !is_string($room['id'] ?? null)) continue;
            $roomId = $this->cleanId($room['id']);
            $game = $this->mutateGame($roomId, function (array $game) use ($now): array {
                $game = $this->normaliseGame($game);
                if ($game['status'] === 'waiting' || $game['status'] === 'starting' || $game['status'] === 'racing') {
                    $game = $this->pruneGame($game, $now);
                }
                return [$game, $game];
            }, false);
            if ($game === null || ($game['status'] ?? '') !== 'waiting') continue;
            $games[] = $this->publicGame($game);
        }

        return [
            'users' => $this->activeLobbyUsers($now),
            'games' => $games,
            // Kept as an alias for older clients; it contains waiting games only.
            'rooms' => $games,
        ];
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function presence(array $body): array
    {
        $id = $this->cleanPlayerId($body['playerId'] ?? '');
        $name = $this->cleanText($body['player'] ?? 'Player', 30) ?: 'Player';
        $now = $this->now();
        if ($this->isInActiveGame($id, $now)) {
            $this->removeLobbyPlayer($id);
        } else {
            $this->touchWaitingGamePlayer($id, $name, $now);
            $this->addLobbyPlayer($id, $name, $now);
        }
        return ['users' => $this->activeLobbyUsers($now), 'serverTime' => $now];
    }

    /** @return array<string, mixed> */
    private function chat(): array
    {
        $since = max(0, (int) ($_GET['since'] ?? 0));
        $room = $this->chatRoom($_GET['room'] ?? self::LOBBY, $_GET['playerId'] ?? null, $_GET['token'] ?? null);
        $messages = $this->store->read('chat_' . $room);
        $messages = array_values(array_filter(
            $messages,
            static fn (mixed $message): bool => is_array($message) && (int) ($message['id'] ?? 0) > $since,
        ));
        return ['room' => $room, 'messages' => array_slice($messages, -100)];
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function sendChat(array $body): array
    {
        $room = $this->chatRoom($body['room'] ?? self::LOBBY, $body['playerId'] ?? null, $body['token'] ?? null);
        $player = $this->cleanText($body['player'] ?? 'Player', 30) ?: 'Player';
        if ($room !== self::LOBBY) {
            $game = $this->game($room);
            $member = $this->findPlayerByToken($game, (string) ($body['token'] ?? ''));
            if ($member === null) throw new HttpException(401, 'Unknown or expired race token');
            $player = $member['name'] ?? 'Player';
        }
        $text = $this->cleanText($body['message'] ?? '', 160);
        if ($text === '') throw new HttpException(422, 'Message is required');
        $message = [
            'id' => (int) floor(microtime(true) * 1000), 'room' => $room,
            'player' => $player, 'message' => $text, 'sentAt' => gmdate(DATE_ATOM),
        ];
        $this->store->mutate('chat_' . $room, static function (array $messages) use ($message): array {
            $messages[] = $message;
            if (count($messages) > 500) $messages = array_slice($messages, -500);
            return [$messages, null];
        });
        return ['message' => $message];
    }

    private function chatRoom(mixed $room, mixed $playerId, mixed $token): string
    {
        if ($room === null || $room === '' || $room === self::LOBBY) return self::LOBBY;
        $roomId = $this->cleanId($room);
        $id = $this->cleanPlayerId($playerId ?? '');
        $raceToken = $this->cleanToken($token ?? '');
        $game = $this->game($roomId);
        if (!in_array($game['status'], ['starting', 'racing'], true)) {
            throw new HttpException(409, 'Private game chat is available after the game starts');
        }
        $member = $this->findPlayerByToken($game, $raceToken);
        if ($member === null || ($member['id'] ?? '') !== $id ||
            (int) ($member['updatedAt'] ?? 0) < $this->now() - self::RACE_PLAYER_TTL_MS) {
            throw new HttpException(403, 'Only game players can use private chat');
        }
        return $roomId;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function createRoom(array $body): array
    {
        $name = $this->cleanText($body['name'] ?? '', 40);
        [$track, $trackData] = $this->trackSelection($body['track'] ?? 'ClassicH', $body['trackData'] ?? null);
        $playerId = $this->cleanPlayerId($body['playerId'] ?? '');
        $playerName = $this->cleanText($body['player'] ?? 'Player', 30) ?: 'Player';
        if ($name === '') throw new HttpException(422, 'Game name is required');
        $now = $this->now();
        $roomId = bin2hex(random_bytes(8));
        $player = $this->newPlayer($playerId, $playerName, $track, $body['craft'] ?? 'basic_craft', $now, 0);
        $game = [
            'id' => $roomId, 'name' => $name, 'track' => $track, 'status' => 'waiting',
            'capacity' => self::CAPACITY, 'createdAt' => $now, 'hostId' => $playerId,
            'startAt' => null, 'players' => [$player], 'trackData' => $trackData,
        ];
        $room = [
            'id' => $roomId, 'name' => $name, 'track' => $track,
            'status' => 'waiting', 'capacity' => self::CAPACITY, 'createdAt' => $now,
        ];
        $this->store->mutate('rooms', static function (array $rooms) use ($room): array {
            $rooms[] = $room;
            return [$rooms, null];
        });
        $this->store->mutate('game_' . $roomId, static function (array $unused) use ($game): array {
            return [$game, null];
        });
        $this->addLobbyPlayer($playerId, $playerName, $now);
        return ['game' => $this->publicGame($game), 'session' => $this->session($game, $player)];
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function joinRace(array $body): array
    {
        $roomId = $this->cleanId($body['room'] ?? '');
        if ($roomId === self::LOBBY) throw new HttpException(409, 'Select a waiting game first');
        $playerId = $this->cleanPlayerId($body['playerId'] ?? '');
        $playerName = $this->cleanText($body['player'] ?? 'Player', 30) ?: 'Player';
        $room = $this->findRoom($roomId);
        $track = $this->cleanTrackName($room['track'] ?? 'ClassicH');
        if (isset($body['track']) && $body['track'] !== $track) {
            throw new HttpException(409, 'Game track does not match');
        }
        $craft = $this->enumValue($body['craft'] ?? 'basic_craft',
            ['basic_craft', 'cx_craft', 'bi_craft', 'eon_craft'], 'craft');
        $now = $this->now();
        $result = $this->mutateGame($roomId, function (array $game) use ($playerId, $playerName, $track, $craft, $now): array {
            $game = $this->normaliseGame($game);
            $game = $this->pruneGame($game, $now);
            if ($game['status'] !== 'waiting') throw new HttpException(409, 'This game has already started');
            if ($game['track'] !== $track) throw new HttpException(409, 'Game track does not match');
            foreach ($game['players'] as $player) {
                if (($player['id'] ?? '') === $playerId) return [$game, $this->session($game, $player)];
            }
            if (count($game['players']) >= self::CAPACITY) throw new HttpException(409, 'Game is full');
            $slot = 0;
            $used = array_map(static fn (array $player): int => (int) ($player['slot'] ?? 0), $game['players']);
            while (in_array($slot, $used, true)) $slot++;
            $player = $this->newPlayer($playerId, $playerName, $track, $craft, $now, $slot);
            $game['players'][] = $player;
            if (($game['hostId'] ?? null) === null) $game['hostId'] = $playerId;
            return [$game, $this->session($game, $player)];
        });
        $this->addLobbyPlayer($playerId, $playerName, $now);
        return ['session' => $result, 'game' => $this->publicGame($this->game($roomId))];
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function startRace(array $body): array
    {
        $roomId = $this->cleanId($body['room'] ?? '');
        $token = $this->cleanToken($body['token'] ?? '');
        $now = $this->now();
        $game = $this->mutateGame($roomId, function (array $game) use ($token, $now): array {
            $game = $this->normaliseGame($game);
            $game = $this->pruneGame($game, $now);
            if ($game['status'] !== 'waiting') throw new HttpException(409, 'Game has already started');
            $host = $this->findPlayerByToken($game, $token);
            if ($host === null || ($host['id'] ?? '') !== ($game['hostId'] ?? '')) {
                throw new HttpException(403, 'Only the host can start this game');
            }
            $game['status'] = 'starting';
            $game['startAt'] = $now + self::START_DELAY_MS;
            return [$game, $game];
        });
        foreach ($game['players'] as $player) {
            if (is_string($player['id'] ?? null)) $this->removeLobbyPlayer($player['id']);
        }
        return ['room' => $roomId, 'status' => $game['status'], 'startAt' => $game['startAt'], 'serverTime' => $now];
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function leaveRace(array $body): array
    {
        $roomId = $this->cleanId($body['room'] ?? '');
        $token = $this->cleanToken($body['token'] ?? '');
        $now = $this->now();
        $game = $this->mutateGame($roomId, function (array $game) use ($token, $now): array {
            $game = $this->normaliseGame($game);
            $remaining = [];
            $leaving = null;
            foreach ($game['players'] as $player) {
                if (($player['token'] ?? '') === $token) $leaving = $player;
                else $remaining[] = $player;
            }
            if ($leaving === null) throw new HttpException(401, 'Unknown or expired race token');
            $game['players'] = $remaining;
            if ($game['status'] === 'waiting' && ($leaving['id'] ?? '') === ($game['hostId'] ?? '')) {
                $game['hostId'] = $remaining[0]['id'] ?? null;
            }
            if ($game['status'] === 'waiting') $game = $this->pruneGame($game, $now);
            return [$game, $game];
        });
        $this->addRoomHost($roomId, $game['hostId'] ?? null);
        return ['room' => $roomId, 'status' => $game['status'], 'players' => count($game['players'])];
    }

    /** @return array<string, mixed> */
    private function raceState(): array
    {
        $roomId = $this->cleanId($_GET['room'] ?? '');
        $token = $_GET['token'] ?? null;
        $now = $this->now();
        $game = $this->mutateGame($roomId, function (array $game) use ($token, $now): array {
            $game = $this->normaliseGame($game);
            if ($game['status'] === 'starting' && is_int($game['startAt']) && $now >= $game['startAt']) {
                $game['status'] = 'racing';
            }
            $game = $this->pruneGame($game, $now);
            if (is_string($token) && $token !== '') {
                foreach ($game['players'] as &$player) {
                    if (($player['token'] ?? '') === $token) $player['updatedAt'] = $now;
                }
                unset($player);
            }
            return [$game, $game];
        });
        return $this->racePayload($game, $now);
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function publishRaceState(array $body): array
    {
        $roomId = $this->cleanId($body['room'] ?? '');
        $token = $this->cleanToken($body['token'] ?? '');
        $state = $this->cleanRaceState($body['state'] ?? null);
        $now = $this->now();
        $game = $this->mutateGame($roomId, function (array $game) use ($token, $state, $now): array {
            $game = $this->normaliseGame($game);
            if ($game['status'] === 'starting' && is_int($game['startAt']) && $now >= $game['startAt']) {
                $game['status'] = 'racing';
            }
            if ($game['status'] !== 'racing') throw new HttpException(409, 'Race has not started');
            $found = false;
            foreach ($game['players'] as &$player) {
                if (($player['token'] ?? '') === $token) {
                    $player['state'] = $state;
                    $player['updatedAt'] = $now;
                    $found = true;
                    break;
                }
            }
            unset($player);
            if (!$found) throw new HttpException(401, 'Unknown or expired race token');
            $game = $this->pruneGame($game, $now);
            return [$game, $game];
        });
        return $this->racePayload($game, $now);
    }

    /** @param array<string, mixed> $game @return array<string, mixed> */
    private function racePayload(array $game, int $now): array
    {
        return [
            'room' => $game['id'], 'status' => $game['status'], 'startAt' => $game['startAt'],
            'serverTime' => $now,
            'players' => array_map(fn (array $player): array => $this->publicPlayer($player), $game['players']),
        ];
    }

    /** @param array<string, mixed> $game @return array<string, mixed> */
    private function publicGame(array $game): array
    {
        return [
            'id' => $game['id'], 'name' => $game['name'], 'track' => $game['track'],
            'status' => $game['status'], 'capacity' => $game['capacity'],
            'players' => array_map(fn (array $player): array => $this->publicPlayer($player, false), $game['players']),
            'hostId' => $game['hostId'], 'createdAt' => $game['createdAt'],
        ];
    }

    /** @param array<string, mixed> $player @return array<string, mixed> */
    private function publicPlayer(array $player, bool $includeState = true): array
    {
        $answer = [
            'id' => $player['id'] ?? '', 'name' => $player['name'] ?? 'Player',
            'track' => $player['track'] ?? 'ClassicH', 'craft' => $player['craft'] ?? 'basic_craft',
            'startSlot' => $player['slot'] ?? 0, 'updatedAt' => $player['updatedAt'] ?? 0,
        ];
        if ($includeState) $answer['state'] = $player['state'] ?? null;
        return $answer;
    }

    /** @param array<string, mixed> $game @param array<string, mixed> $player @return array<string, mixed> */
    private function session(array $game, array $player): array
    {
        return [
            'room' => $game['id'], 'playerId' => $player['id'], 'token' => $player['token'],
            'startSlot' => $player['slot'], 'serverTime' => $this->now(),
            'status' => $game['status'], 'startAt' => $game['startAt'],
            'track' => $game['track'], 'craft' => $player['craft'],
            'trackData' => $game['trackData'] ?? null,
            'isHost' => ($player['id'] ?? '') === ($game['hostId'] ?? ''),
        ];
    }

    /** @return array{0: string, 1: array<string, mixed>|null} */
    private function trackSelection(mixed $name, mixed $data): array
    {
        $track = $this->cleanTrackName($name);
        if (!$this->isCustomTrack($track)) return [$track, null];
        return [$track, $this->cleanTrackData($data)];
    }

    private function cleanTrackName(mixed $value): string
    {
        if (!is_string($value)) throw new HttpException(422, 'Invalid track');
        if (in_array($value, ['ClassicH', 'Steeplechase', 'The Alley2', 'The River'], true)) return $value;
        if (preg_match('/^imported-[a-z0-9_-]{1,55}$/', $value)) return $value;
        throw new HttpException(422, 'Invalid track');
    }

    private function isCustomTrack(string $track): bool
    {
        return str_starts_with($track, 'imported-');
    }

    /** @return array<string, mixed> */
    private function cleanTrackData(mixed $value): array
    {
        if (!is_array($value) || !is_array($value['starts'] ?? null) || count($value['starts']) < 1 ||
            !is_array($value['rooms'] ?? null) || count($value['rooms']) < 1) {
            throw new HttpException(422, 'Custom track data is required');
        }
        $encoded = json_encode($value);
        if ($encoded === false || strlen($encoded) > self::CUSTOM_TRACK_BYTES) {
            throw new HttpException(422, 'Custom track is too large');
        }
        foreach ($value['rooms'] as $room) {
            if (!is_array($room) || !is_array($room['vertices'] ?? null) || count($room['vertices']) < 3 ||
                !is_array($room['neighbors'] ?? null)) {
                throw new HttpException(422, 'Custom track geometry is incomplete');
            }
        }
        return $value;
    }

    /** @param array<string, mixed> $body @return array<string, mixed> */
    private function newPlayer(string $id, string $name, string $track, mixed $craft, int $now, int $slot): array
    {
        $craft = $this->enumValue($craft, ['basic_craft', 'cx_craft', 'bi_craft', 'eon_craft'], 'craft');
        return [
            'id' => $id, 'token' => bin2hex(random_bytes(24)), 'name' => $name,
            'track' => $track, 'craft' => $craft, 'slot' => $slot,
            'joinedAt' => $now, 'updatedAt' => $now, 'state' => null,
        ];
    }

    /** @return array<string, mixed> */
    private function findRoom(string $roomId): array
    {
        foreach ($this->store->read('rooms') as $room) {
            if (is_array($room) && ($room['id'] ?? '') === $roomId) return $room;
        }
        throw new HttpException(404, 'Game not found');
    }

    /** @return array<string, mixed> */
    private function game(string $roomId): array
    {
        $game = $this->store->read('game_' . $roomId);
        if (!isset($game['id'], $game['players'])) throw new HttpException(404, 'Game not found');
        return $this->normaliseGame($game);
    }

    /** @template T @param callable(array<string, mixed>): array{0: array<string, mixed>, 1: T} $callback @return T|null */
    private function mutateGame(string $roomId, callable $callback, bool $required = true): mixed
    {
        if (!$required && !is_file($this->storePath('game_' . $roomId))) return null;
        return $this->store->mutate('game_' . $roomId, function (array $game) use ($callback, $required): array {
            if ($required && !isset($game['id'])) throw new HttpException(404, 'Game not found');
            if (!$required && !isset($game['id'])) return [$game, null];
            return $callback($game);
        });
    }

    /** @param array<string, mixed> $game @return array<string, mixed> */
    private function normaliseGame(array $game): array
    {
        $game['players'] = is_array($game['players'] ?? null) ? array_values(array_filter($game['players'], 'is_array')) : [];
        $game['status'] = $game['status'] ?? 'waiting';
        $game['startAt'] = isset($game['startAt']) && is_numeric($game['startAt']) ? (int) $game['startAt'] : null;
        $game['capacity'] = (int) ($game['capacity'] ?? self::CAPACITY);
        return $game;
    }

    /** @param array<string, mixed> $game @return array<string, mixed> */
    private function pruneGame(array $game, int $now): array
    {
        $ttl = $game['status'] === 'waiting' ? self::WAITING_PLAYER_TTL_MS : self::RACE_PLAYER_TTL_MS;
        $game['players'] = array_values(array_filter($game['players'], static fn (array $player): bool =>
            (int) ($player['updatedAt'] ?? 0) >= $now - $ttl));
        if (!in_array($game['hostId'] ?? null, array_column($game['players'], 'id'), true)) {
            $game['hostId'] = $game['players'][0]['id'] ?? null;
        }
        return $game;
    }

    /** @param array<string, mixed> $game @return array<string, mixed>|null */
    private function findPlayerByToken(array $game, string $token): ?array
    {
        foreach ($game['players'] as $player) if (($player['token'] ?? '') === $token) return $player;
        return null;
    }

    private function isInActiveGame(string $playerId, int $now): bool
    {
        foreach ($this->store->read('rooms') as $room) {
            if (!is_array($room) || !in_array($room['status'] ?? 'waiting', ['waiting', 'starting', 'racing'], true)) continue;
            $roomId = (string) ($room['id'] ?? '');
            if ($roomId === '' || !is_file($this->storePath('game_' . $roomId))) continue;
            $game = $this->game($roomId);
            if (!in_array($game['status'], ['starting', 'racing'], true)) continue;
            foreach ($game['players'] as $player) {
                if (($player['id'] ?? '') === $playerId && (int) ($player['updatedAt'] ?? 0) >= $now - self::RACE_PLAYER_TTL_MS) return true;
            }
        }
        return false;
    }

    private function touchWaitingGamePlayer(string $playerId, string $name, int $now): void
    {
        foreach ($this->store->read('rooms') as $room) {
            if (!is_array($room) || ($room['status'] ?? 'waiting') !== 'waiting') continue;
            $roomId = (string) ($room['id'] ?? '');
            if ($roomId === '' || !is_file($this->storePath('game_' . $roomId))) continue;
            $this->mutateGame($roomId, function (array $game) use ($playerId, $name, $now): array {
                $game = $this->normaliseGame($game);
                if ($game['status'] !== 'waiting') return [$game, null];
                foreach ($game['players'] as &$player) {
                    if (($player['id'] ?? '') === $playerId) {
                        $player['name'] = $name;
                        $player['updatedAt'] = $now;
                        unset($player);
                        return [$game, true];
                    }
                }
                unset($player);
                return [$game, null];
            }, false);
        }
    }

    private function addLobbyPlayer(string $playerId, string $name, int $now): void
    {
        $this->store->mutate('lobby', function (array $users) use ($playerId, $name, $now): array {
            $users = array_values(array_filter($users, static fn (mixed $user): bool =>
                is_array($user) && (int) ($user['updatedAt'] ?? 0) >= $now - self::PRESENCE_TTL_MS &&
                ($user['id'] ?? '') !== $playerId));
            $users[] = ['id' => $playerId, 'name' => $name, 'updatedAt' => $now];
            return [$users, null];
        });
    }

    /** @return list<array<string, mixed>> */
    private function activeLobbyUsers(int $now): array
    {
        $users = $this->store->mutate('lobby', static function (array $users) use ($now): array {
            $users = array_values(array_filter($users, static fn (mixed $user): bool =>
                is_array($user) && (int) ($user['updatedAt'] ?? 0) >= $now - self::PRESENCE_TTL_MS));
            return [$users, $users];
        });
        return array_map(static fn (array $user): array => [
            'id' => $user['id'] ?? '', 'name' => $user['name'] ?? 'Player',
        ], $users);
    }

    private function removeLobbyPlayer(string $playerId): void
    {
        $this->store->mutate('lobby', static function (array $users) use ($playerId): array {
            return [array_values(array_filter($users, static fn (mixed $user): bool =>
                is_array($user) && ($user['id'] ?? '') !== $playerId)), null];
        });
    }

    private function addRoomHost(string $roomId, ?string $hostId): void
    {
        $this->store->mutate('rooms', static function (array $rooms) use ($roomId, $hostId): array {
            foreach ($rooms as &$room) if (is_array($room) && ($room['id'] ?? '') === $roomId) $room['hostId'] = $hostId;
            unset($room);
            return [$rooms, null];
        });
    }

    private function storePath(string $name): string
    {
        $directory = getenv('HOVERRACE_STORE_DIR');
        if (!is_string($directory) || $directory === '') $directory = dirname(__DIR__) . '/var';
        return $directory . DIRECTORY_SEPARATOR . $name . '.json';
    }

    private function now(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    /** @return array<string, mixed> */
    private function body(): array
    {
        $raw = file_get_contents('php://input');
        $decoded = json_decode($raw === false ? '' : $raw, true, 16, JSON_THROW_ON_ERROR);
        if (!is_array($decoded)) throw new HttpException(400, 'JSON object required');
        return $decoded;
    }

    private function cleanPlayerId(mixed $value): string
    {
        if (!is_string($value) || !preg_match('/^[a-zA-Z0-9_-]{8,80}$/', $value)) {
            throw new HttpException(422, 'Invalid player identifier');
        }
        return $value;
    }

    private function cleanToken(mixed $value): string
    {
        if (!is_string($value) || !preg_match('/^[a-f0-9]{48}$/', $value)) {
            throw new HttpException(401, 'Invalid race token');
        }
        return $value;
    }

    private function cleanId(mixed $value): string
    {
        if (!is_string($value) || !preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $value)) {
            throw new HttpException(422, 'Invalid game identifier');
        }
        return strtolower($value);
    }

    /** @param list<string> $allowed */
    private function enumValue(mixed $value, array $allowed, string $name): string
    {
        if (!is_string($value) || !in_array($value, $allowed, true)) throw new HttpException(422, "Invalid {$name}");
        return $value;
    }

    private function cleanText(mixed $value, int $limit): string
    {
        if (!is_string($value)) return '';
        $value = trim(strip_tags($value));
        $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
        if (function_exists('mb_substr')) return mb_substr($value, 0, $limit);
        preg_match_all('/./us', $value, $characters);
        return implode('', array_slice($characters[0] ?? [], 0, $limit));
    }

    /** @param mixed $value @return array<string, mixed> */
    private function cleanRaceState(mixed $value): array
    {
        if (!is_array($value)) throw new HttpException(422, 'Race state object is required');
        $position = $this->numberVector($value['position'] ?? null, 3, 10_000_000, 'position');
        $velocity = $this->numberVector($value['velocity'] ?? null, 3, 1000, 'velocity');
        $orientation = filter_var($value['orientation'] ?? null, FILTER_VALIDATE_INT);
        $cabinOrientation = filter_var($value['cabinOrientation'] ?? $orientation, FILTER_VALIDATE_INT);
        $room = filter_var($value['room'] ?? null, FILTER_VALIDATE_INT);
        $raceTime = $value['raceTime'] ?? null;
        if ($orientation === false || $orientation < 0 || $orientation > 4095 ||
            $cabinOrientation === false || $cabinOrientation < 0 || $cabinOrientation > 4095 ||
            $room === false || $room < -1 || $room > 2047) throw new HttpException(422, 'Invalid race state');
        if (!is_int($raceTime) && !is_float($raceTime)) throw new HttpException(422, 'Invalid race time');
        $raceTime = (float) $raceTime;
        if (!is_finite($raceTime) || $raceTime < 0 || $raceTime > 10_000_000) throw new HttpException(422, 'Invalid race time');
        return [
            'position' => $position, 'velocity' => $velocity, 'orientation' => $orientation,
            'cabinOrientation' => $cabinOrientation, 'room' => $room, 'raceTime' => $raceTime,
            'motorOn' => (bool) ($value['motorOn'] ?? false), 'lap' => max(1, min(3, (int) ($value['lap'] ?? 1))),
            'checkpoint' => max(0, min(2, (int) ($value['checkpoint'] ?? 0))), 'finished' => (bool) ($value['finished'] ?? false),
            'actorVisible' => $this->cleanBooleanList($value['actorVisible'] ?? []),
            'actorFrames' => $this->cleanActorFrames($value['actorFrames'] ?? []),
            'projectiles' => $this->cleanProjectiles($value['projectiles'] ?? []),
        ];
    }

    /** @return list<float> */
    private function numberVector(mixed $value, int $length, float $limit, string $name): array
    {
        if (!is_array($value) || count($value) !== $length) throw new HttpException(422, "Invalid {$name}");
        $answer = [];
        foreach ($value as $component) {
            if (!is_int($component) && !is_float($component)) throw new HttpException(422, "Invalid {$name}");
            $component = (float) $component;
            if (!is_finite($component) || abs($component) > $limit) throw new HttpException(422, "Invalid {$name}");
            $answer[] = $component;
        }
        return $answer;
    }

    /** @return list<bool> */
    private function cleanBooleanList(mixed $value): array
    {
        if (!is_array($value) || count($value) > 512) throw new HttpException(422, 'Invalid actor visibility');
        return array_map(static fn (mixed $entry): bool => (bool) $entry, array_values($value));
    }

    /** @return list<int|null> */
    private function cleanActorFrames(mixed $value): array
    {
        if (!is_array($value) || count($value) > 512) throw new HttpException(422, 'Invalid actor frames');
        $answer = [];
        foreach (array_values($value) as $frame) {
            if ($frame === null) { $answer[] = null; continue; }
            if ((!is_int($frame) && !is_float($frame)) || !is_finite((float) $frame)) throw new HttpException(422, 'Invalid actor frame');
            $answer[] = max(0, min(9, (int) $frame));
        }
        return $answer;
    }

    /** @return list<array<string, mixed>> */
    private function cleanProjectiles(mixed $value): array
    {
        if (!is_array($value)) throw new HttpException(422, 'Invalid projectiles');
        $answer = [];
        foreach (array_slice($value, 0, 16) as $projectile) {
            if (!is_array($projectile)) continue;
            $kind = $this->enumValue($projectile['kind'] ?? '', ['missile', 'mine', 'powerup'], 'projectile kind');
            $orientation = filter_var($projectile['orientation'] ?? null, FILTER_VALIDATE_INT);
            $room = filter_var($projectile['room'] ?? null, FILTER_VALIDATE_INT);
            $age = $projectile['age'] ?? null;
            if ($orientation === false || $orientation < 0 || $orientation > 4095 || $room === false || $room < -1 || $room > 2047 ||
                (!is_int($age) && !is_float($age)) || !is_finite((float) $age)) throw new HttpException(422, 'Invalid projectile state');
            $answer[] = [
                'id' => (int) ($projectile['id'] ?? 0), 'kind' => $kind,
                'position' => $this->numberVector($projectile['position'] ?? null, 3, 10_000_000, 'projectile position'),
                'orientation' => $orientation, 'room' => $room, 'age' => max(0.0, min(8700.0, (float) $age)),
                'exploded' => (bool) ($projectile['exploded'] ?? false), 'active' => true,
            ];
        }
        return $answer;
    }

    /** @param array<string, mixed> $payload */
    private function json(array $payload, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }
}

final class HttpException extends \RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

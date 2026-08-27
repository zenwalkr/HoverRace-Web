<?php

declare(strict_types=1);

namespace HoverRace\Server;

final class ApiEndpoint
{
    public static function path(mixed $route): string
    {
        return match ($route) {
            'status' => '/api/status',
            'rooms' => '/api/rooms',
            'presence' => '/api/presence',
            'chat' => '/api/chat',
            'race_join' => '/api/race/join',
            'race_start' => '/api/race/start',
            'race_leave' => '/api/race/leave',
            'race_state' => '/api/race/state',
            default => '/api/__invalid__',
        };
    }
}

<?php

declare(strict_types=1);

namespace HoverRace\Server;

final class JsonStore
{
    public function __construct(private readonly string $directory)
    {
        if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new \RuntimeException('Unable to create state directory');
        }
    }

    /** @return array<mixed> */
    public function read(string $name): array
    {
        $handle = $this->open($name);
        try {
            if (!flock($handle, LOCK_SH)) throw new \RuntimeException('Unable to lock state file');
            $contents = stream_get_contents($handle);
            flock($handle, LOCK_UN);
            $decoded = $contents === false || trim($contents) === '' ? [] : json_decode($contents, true, 64, JSON_THROW_ON_ERROR);
            return is_array($decoded) ? $decoded : [];
        } finally {
            fclose($handle);
        }
    }

    /**
     * @template T
     * @param callable(array<mixed>): array{0: array<mixed>, 1: T} $callback
     * @return T
     */
    public function mutate(string $name, callable $callback): mixed
    {
        $handle = $this->open($name);
        try {
            if (!flock($handle, LOCK_EX)) throw new \RuntimeException('Unable to lock state file');
            rewind($handle);
            $contents = stream_get_contents($handle);
            $state = $contents === false || trim($contents) === '' ? [] : json_decode($contents, true, 64, JSON_THROW_ON_ERROR);
            if (!is_array($state)) $state = [];
            [$nextState, $result] = $callback($state);
            rewind($handle);
            ftruncate($handle, 0);
            fwrite($handle, json_encode($nextState, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
            fflush($handle);
            flock($handle, LOCK_UN);
            return $result;
        } finally {
            fclose($handle);
        }
    }

    /** @return resource */
    private function open(string $name)
    {
        if (!preg_match('/^[a-z0-9_-]+$/', $name)) throw new \InvalidArgumentException('Invalid state name');
        $handle = fopen($this->directory . DIRECTORY_SEPARATOR . $name . '.json', 'c+');
        if ($handle === false) throw new \RuntimeException('Unable to open state file');
        return $handle;
    }
}

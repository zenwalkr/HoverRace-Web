<?php

declare(strict_types=1);

use HoverRace\Server\Api;
use HoverRace\Server\ApiEndpoint;
use HoverRace\Server\JsonStore;

require dirname(__DIR__) . '/src/JsonStore.php';
require dirname(__DIR__) . '/src/Api.php';
require dirname(__DIR__) . '/src/ApiEndpoint.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$dispatchPath = $path === '/api.php'
    ? ApiEndpoint::path($_GET['route'] ?? null)
    : $path;

if (!str_starts_with($dispatchPath, '/api')) {
    $dist = realpath(dirname(__DIR__, 2) . '/dist');
    if ($dist === false) {
        http_response_code(503);
        header('Content-Type: text/plain; charset=utf-8');
        echo "Web build not found. Run npm run build first.\n";
        return;
    }
    $requested = $path === '/' ? '/index.html' : $path;
    $file = realpath($dist . $requested);
    if ($file === false || !str_starts_with($file, $dist . DIRECTORY_SEPARATOR) || !is_file($file)) {
        $file = $dist . '/index.html';
    }
    $type = match (strtolower(pathinfo($file, PATHINFO_EXTENSION))) {
        'html' => 'text/html; charset=utf-8',
        'js' => 'text/javascript; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'png' => 'image/png',
        'wav' => 'audio/wav',
        default => 'application/octet-stream',
    };
    header('Content-Type: ' . $type);
    header(str_contains($file, DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR)
        ? 'Cache-Control: public, max-age=31536000, immutable'
        : 'Cache-Control: no-cache');
    header('X-Content-Type-Options: nosniff');
    readfile($file);
    return;
}

$storeDirectory = getenv('HOVERRACE_STORE_DIR');
if (!is_string($storeDirectory) || $storeDirectory === '') {
    $storeDirectory = dirname(__DIR__) . '/var';
}
$store = new JsonStore($storeDirectory);
(new Api($store))->dispatch($method, $dispatchPath);

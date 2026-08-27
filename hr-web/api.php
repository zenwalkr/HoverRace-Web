<?php

declare(strict_types=1);

use HoverRace\Server\Api;
use HoverRace\Server\ApiEndpoint;
use HoverRace\Server\JsonStore;

require __DIR__ . '/server/src/JsonStore.php';
require __DIR__ . '/server/src/Api.php';
require __DIR__ . '/server/src/ApiEndpoint.php';

$storeDirectory = getenv('HOVERRACE_STORE_DIR');
if (!is_string($storeDirectory) || $storeDirectory === '') {
    $storeDirectory = __DIR__ . '/server/var';
}

$store = new JsonStore($storeDirectory);
$path = ApiEndpoint::path($_GET['route'] ?? null);
(new Api($store))->dispatch(strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'), $path);

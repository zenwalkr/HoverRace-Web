<?php

declare(strict_types=1);

// Vite copies this wrapper into dist/. Keep the implementation at the project
// root so PHP backend changes do not require rebuilding the browser bundle.
require dirname(__DIR__) . '/api.php';

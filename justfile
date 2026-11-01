set shell := ["bash", "-c"]

NPM := env('NPM', 'npm')
NPX := env('NPX', 'npx')
WEB_PORT := env('AIP_WEB_PORT', '7341')

[private]
default:
    @{{ just_executable() }} --list

import 'env/justice/quality.just'
import 'env/justice/build.just'
import 'env/justice/web.just'

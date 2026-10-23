// Copyright (c) 2026 qingye-reader contributors
// SPDX-License-Identifier: MIT

#ifndef QUICKJS_SCRIPT_SESSION_H
#define QUICKJS_SCRIPT_SESSION_H

#include "napi/native_api.h"

/**
 * Script sessions run QuickJS on a dedicated background thread. Scripts call the host
 * synchronously through `__host(name, payload)`: the call is posted to the ArkTS thread, which
 * performs the work (possibly asynchronously) and answers with scriptSessionResolve while the
 * script thread waits. The ArkTS thread never waits for the script thread.
 */
void DefineScriptSessionExports(napi_env env, napi_value exports);

#endif // QUICKJS_SCRIPT_SESSION_H

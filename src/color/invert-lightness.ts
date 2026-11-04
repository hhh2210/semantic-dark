/*
 * Copyright (C) 2024-2026 Samuel Weinig <sam@webkit.org>
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import {clipSrgb} from './srgb';
import type {SrgbColor} from './types';

/**
 * WebKit's public apple-invert-lightness() transform, adapted to bounded sRGB.
 * Source at 549bd1fb46a60fc3d27f30d7cf32fc04611d73a3:
 * Source/WebCore/style/values/filter-effects/StyleAppleInvertLightnessFunction.cpp
 * This is the public legacy algorithm, not the private Safari 27.3 controller.
 *
 * A 180-degree HSL hue rotation is max + min - channel for bounded RGB. The
 * subsequent affine matrix reverses lightness with a contrast correction.
 * Work in gamma-encoded sRGB, not linear RGB; preserve alpha. Do not quantize
 * here: DOM serialization and raster output own their respective byte grids.
 */
export function invertLightness(color: SrgbColor): SrgbColor {
  const source = clipSrgb(color);
  const sum = Math.max(source.r, source.g, source.b) + Math.min(source.r, source.g, source.b);
  const r = sum - source.r;
  const g = sum - source.g;
  const b = sum - source.b;
  return clipSrgb({
    r: 1 - 0.770 * r + 0.059 * g - 0.089 * b,
    g: 1 + 0.030 * r - 0.741 * g - 0.089 * b,
    b: 1 + 0.030 * r + 0.059 * g - 0.890 * b,
    a: source.a,
  });
}

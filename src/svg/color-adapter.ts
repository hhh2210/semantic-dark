import {mapColor} from '../color';

import type {SvgColorTransformer} from './types';

/** Adapter from SVG paint relationships to the shared matrix/contrast mapper. */
export const sharedSvgColorTransformer: SvgColorTransformer = {
    mapColor(color, request) {
        return mapColor(color, {
            role: request.role,
            background: request.background,
            preserveHue: request.preserveHue,
            property: request.property,
            ...(request.minContrast === undefined
                ? {}
                : {minContrast: request.minContrast}),
        });
    },
};

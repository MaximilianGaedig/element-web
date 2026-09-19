/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Icons from Telegram Web K's icon font (GPL-3.0, https://github.com/morethanwords/tweb), drawn from
 * the font's source SVGs in assets/icons/. The glyph name each one has in tweb's src/icons.ts is noted.
 */

import React, { type JSX, type SVGProps } from "react";
import classNames from "classnames";

import { TG_ICON_PATHS, type TgIconName, type TgIconPath } from "./tgIconPaths";

type IconProps = SVGProps<SVGSVGElement>;

/** A 19x14 time-row glyph (tweb's status icons share this grid). */
function StatusGlyph({ d, ...props }: IconProps & { d: string }): JSX.Element {
    return (
        <svg viewBox="0 0 19 14" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
            <path d={d} />
        </svg>
    );
}

/** tweb `check` (assets/icons/1check.svg). */
export function TgCheckIcon(props: IconProps): JSX.Element {
    return (
        <StatusGlyph
            {...props}
            d="M7.96833846,10.0490996 L14.5108251,2.571972 C14.7472185,2.30180819 15.1578642,2.27443181 15.428028,2.51082515 C15.6711754,2.72357915 15.717665,3.07747757 15.5522007,3.34307913 L15.4891749,3.428028 L8.48917485,11.428028 C8.2663359,11.6827011 7.89144111,11.7199091 7.62486888,11.5309823 L7.54038059,11.4596194 L4.54038059,8.45961941 C4.2865398,8.20577862 4.2865398,7.79422138 4.54038059,7.54038059 C4.7688373,7.31192388 5.12504434,7.28907821 5.37905111,7.47184358 L5.45961941,7.54038059 L7.96833846,10.0490996 L14.5108251,2.571972 L7.96833846,10.0490996 Z"
        />
    );
}

/** tweb `checks` (assets/icons/2checks.svg). */
export function TgChecksIcon(props: IconProps): JSX.Element {
    return (
        <StatusGlyph
            {...props}
            d="M4.96833846,10.0490996 L11.5108251,2.571972 C11.7472185,2.30180819 12.1578642,2.27443181 12.428028,2.51082515 C12.6711754,2.72357915 12.717665,3.07747757 12.5522007,3.34307913 L12.4891749,3.428028 L5.48917485,11.428028 C5.2663359,11.6827011 4.89144111,11.7199091 4.62486888,11.5309823 L4.54038059,11.4596194 L1.54038059,8.45961941 C1.2865398,8.20577862 1.2865398,7.79422138 1.54038059,7.54038059 C1.7688373,7.31192388 2.12504434,7.28907821 2.37905111,7.47184358 L2.45961941,7.54038059 L4.96833846,10.0490996 L11.5108251,2.571972 L4.96833846,10.0490996 Z M9.96833846,10.0490996 L16.5108251,2.571972 C16.7472185,2.30180819 17.1578642,2.27443181 17.428028,2.51082515 C17.6711754,2.72357915 17.717665,3.07747757 17.5522007,3.34307913 L17.4891749,3.428028 L10.4891749,11.428028 C10.2663359,11.6827011 9.89144111,11.7199091 9.62486888,11.5309823 L9.54038059,11.4596194 L8.54038059,10.4596194 C8.2865398,10.2057786 8.2865398,9.79422138 8.54038059,9.54038059 C8.7688373,9.31192388 9.12504434,9.28907821 9.37905111,9.47184358 L9.45961941,9.54038059 L9.96833846,10.0490996 L16.5108251,2.571972 L9.96833846,10.0490996 Z"
        />
    );
}

/** tweb `sending` (assets/icons/sending.svg): a clock. */
export function TgSendingIcon(props: IconProps): JSX.Element {
    return (
        <StatusGlyph
            {...props}
            d="M10,0.4 C13.6450793,0.4 16.6,3.35492065 16.6,7 C16.6,10.6450793 13.6450793,13.6 10,13.6 C6.35492065,13.6 3.4,10.6450793 3.4,7 C3.4,3.35492065 6.35492065,0.4 10,0.4 Z M10,1.6 C7.01766235,1.6 4.6,4.01766235 4.6,7 C4.6,9.98233765 7.01766235,12.4 10,12.4 C12.9823376,12.4 15.4,9.98233765 15.4,7 C15.4,4.01766235 12.9823376,1.6 10,1.6 Z M9.44596525,7.34011651 L9.42484493,7.30317254 L9.42484493,7.30317254 L9.37752037,7.18772859 L9.37752037,7.18772859 L9.35761522,7.09949427 L9.35190381,7.04986542 L9.35190381,7.04986542 L9.35,3.5 C9.35,3.14101491 9.64101491,2.85 10,2.85 C10.3263501,2.85 10.5965265,3.09050819 10.6429523,3.40394776 L10.65,3.5 L10.65,6.731 L12.4596194,8.54038059 C12.6880761,8.7688373 12.7109218,9.12504434 12.5281564,9.37905111 L12.4596194,9.45961941 C12.2311627,9.68807612 11.8749557,9.71092179 11.6209489,9.52815642 L11.5403806,9.45961941 L9.50840405,7.42526395 L9.50840405,7.42526395 L9.47557418,7.38417154 L9.47557418,7.38417154 L9.44596525,7.34011651 L9.44596525,7.34011651 Z"
        />
    );
}

/** tweb `sendingerror_filled` (assets/icons/sendingerror_filled.svg). */
export function TgSendingErrorIcon(props: IconProps): JSX.Element {
    return (
        <StatusGlyph
            {...props}
            d="M10,0.4 C13.6450793,0.4 16.6,3.35492065 16.6,7 C16.6,10.6450793 13.6450793,13.6 10,13.6 C6.35492065,13.6 3.4,10.6450793 3.4,7 C3.4,3.35492065 6.35492065,0.4 10,0.4 Z M10,9.25 C9.58578644,9.25 9.25,9.58578644 9.25,10 C9.25,10.4142136 9.58578644,10.75 10,10.75 C10.4142136,10.75 10.75,10.4142136 10.75,10 C10.75,9.58578644 10.4142136,9.25 10,9.25 Z M10,2.85 C9.64101491,2.85 9.35,3.14101491 9.35,3.5 L9.35,7.5 C9.35,7.85898509 9.64101491,8.15 10,8.15 C10.3589851,8.15 10.65,7.85898509 10.65,7.5 L10.65,3.5 C10.65,3.14101491 10.3589851,2.85 10,2.85 Z"
        />
    );
}

/** A glyph of tweb's icon font by its tweb name (src/icons.ts), sized by the font size like tgico. */
export function TgIcon({ name, className, ...props }: IconProps & { name: TgIconName }): JSX.Element {
    const { viewBox, d, evenOdd } = TG_ICON_PATHS[name] as TgIconPath;
    return (
        <svg
            viewBox={viewBox}
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
            className={classNames("mx_TgIcon", className)}
            {...props}
        >
            <path d={d} fillRule={evenOdd ? "evenodd" : undefined} clipRule={evenOdd ? "evenodd" : undefined} />
        </svg>
    );
}

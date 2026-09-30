/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What this card has said before now, kept the way a password manager keeps an entry's history.
 *
 * KeePassXC's entry history is the model (its Entry History tab: a list of versions, and Show / Restore /
 * Delete / Empty against the one selected). Two things about it are the point, and both were missing here:
 *
 *  - a version is *read* before it is used. Pressing a row used to restore it, which put an irreversible
 *    overwrite of somebody's contact one stray tap away and gave no way at all to just look at what changed.
 *    Here a row opens the version, and restoring it is a second, named action.
 *  - deleting is per version as well as wholesale, because the reason to prune history is usually one
 *    particular version rather than all of it.
 *
 * What it adds to that model is the comparison: each line of an opened version is marked when it differs from
 * what the card says now, since "what would change if I restored this" is the question being asked.
 */

import React, { type JSX, useState } from "react";
import { Button } from "@vector-im/compound-web";
import BackIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";
import DeleteIcon from "@vector-im/compound-design-tokens/assets/web/icons/delete";
import RestoreIcon from "@vector-im/compound-design-tokens/assets/web/icons/restart";

import { _t } from "../../../languageHandler";
import Modal from "../../../Modal";
import QuestionDialog from "../dialogs/QuestionDialog";
import { type ContactCard } from "../../../utils/contacts/card";
import { KEEP, type Revision, changedFields } from "../../../utils/contacts/history";
import { describeCard, differingKeys } from "../../../utils/contacts/describe";

/*
 * Asked with the client's own dialog rather than the browser's.
 *
 * Both of these throw something away that cannot be got back - restoring overwrites the card as it stands,
 * emptying drops every version - so both are worth a question. window.confirm would ask it in a box the
 * client cannot style, cannot translate the buttons of, and which blocks the whole tab.
 */
async function ask(title: string, description: string, button: string): Promise<boolean> {
    const { finished } = Modal.createDialog(QuestionDialog, { title, description, button });
    const [confirmed] = await finished;
    return !!confirmed;
}

const when = (ts: number): string =>
    new Date(ts).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });

interface Props {
    /** The versions, newest first. */
    history: readonly Revision[];
    /** What the card says now, which is what a version is compared against. */
    card?: ContactCard;
    onRestore: (revision: Revision) => void;
    onDelete: (revision: Revision) => void;
    onEmpty: () => void;
}

/** One version, opened: every line it held, with the ones that differ from now marked. */
function Version({
    revision,
    card,
    onBack,
    onRestore,
    onDelete,
}: {
    revision: Revision;
    card?: ContactCard;
    onBack: () => void;
} & Pick<Props, "onRestore" | "onDelete">): JSX.Element {
    const lines = describeCard(revision.was);
    const differing = differingKeys(lines, card ?? {});

    return (
        <div className="mx_ContactHistory_version">
            <header className="mx_ContactHistory_versionHeader">
                <button type="button" className="mx_ContactHistory_back" onClick={onBack}>
                    <BackIcon width="20" height="20" aria-hidden />
                    <span>{_t("contacts|history")}</span>
                </button>
                <span className="mx_ContactHistory_stamp">
                    {when(revision.ts)}
                    {" · "}
                    {_t(`contacts|edit_${revision.source}`)}
                </span>
            </header>

            <div className="mx_ContactHistory_lines">
                {lines.map((line) => (
                    <div
                        key={line.key}
                        className="mx_ContactHistory_line"
                        data-changed={differing.has(line.key) || undefined}
                    >
                        <span className="mx_ContactHistory_lineLabel">{line.label}</span>
                        <span className="mx_ContactHistory_lineValue">{line.value}</span>
                    </div>
                ))}
                {/* A version of an empty card is a real thing to have kept: it is what "before I typed any of
                    this" looks like, and restoring it is how a card typed onto the wrong person is undone. */}
                {!lines.length && <div className="mx_ContactHistory_none">{_t("contacts|history_none")}</div>}
            </div>

            <div className="mx_ContactHistory_actions">
                <Button
                    kind="primary"
                    size="md"
                    Icon={RestoreIcon}
                    onClick={() => {
                        void ask(
                            _t("contacts|history_restore"),
                            _t("contacts|history_restore_confirm"),
                            _t("contacts|history_restore"),
                        ).then((yes) => yes && onRestore(revision));
                    }}
                >
                    {_t("contacts|history_restore")}
                </Button>
                <Button kind="secondary" size="md" destructive Icon={DeleteIcon} onClick={() => onDelete(revision)}>
                    {_t("contacts|history_delete")}
                </Button>
            </div>
        </div>
    );
}

export function ContactHistory({ history, card, onRestore, onDelete, onEmpty }: Props): JSX.Element {
    /* Which version is open, by its timestamp rather than by the object: the list is refetched from account
       data after a delete, so an object held across that is a different object with the same contents. */
    const [openAt, setOpenAt] = useState<number>();
    const open = history.find((revision) => revision.ts === openAt);

    if (open) {
        return (
            <Version
                revision={open}
                card={card}
                onBack={() => setOpenAt(undefined)}
                onRestore={onRestore}
                onDelete={(revision) => {
                    // Back to the list first: the thing this view is showing is about to stop existing.
                    setOpenAt(undefined);
                    onDelete(revision);
                }}
            />
        );
    }

    return (
        <div className="mx_ContactHistory">
            {history.map((revision) => {
                const changed = changedFields(revision.was, card ?? {});
                return (
                    <button
                        key={revision.ts}
                        type="button"
                        className="mx_ContactHistory_row"
                        onClick={() => setOpenAt(revision.ts)}
                        aria-label={_t("contacts|history_show")}
                    >
                        <span className="mx_ContactHistory_stamp">
                            {when(revision.ts)}
                            {" · "}
                            {_t(`contacts|edit_${revision.source}`)}
                        </span>
                        {/* What is different about it, which is what tells one version from another in a list
                            of timestamps. Names of fields, not values: a column of old phone numbers is not
                            something to scan, and the values are one press away. */}
                        {!!changed.length && (
                            <span className="mx_ContactHistory_changed">
                                {_t("contacts|restore_changed", { fields: changed.join(", ") })}
                            </span>
                        )}
                    </button>
                );
            })}

            <div className="mx_ContactHistory_footer">
                <span className="mx_ContactHistory_kept">{_t("contacts|history_kept", { count: KEEP })}</span>
                <Button
                    kind="tertiary"
                    size="md"
                    destructive
                    Icon={DeleteIcon}
                    onClick={() => {
                        void ask(
                            _t("contacts|history_empty"),
                            _t("contacts|history_empty_confirm"),
                            _t("contacts|history_empty"),
                        ).then((yes) => yes && onEmpty());
                    }}
                >
                    {_t("contacts|history_empty")}
                </Button>
            </div>
        </div>
    );
}

/*
Copyright 2024 New Vector Ltd.
Copyright 2017 Vector Creations Ltd
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** The types of page which can be shown by the LoggedInView */
enum PageType {
    HomePage = "home_page",
    RoomView = "room_view",
    UserView = "user_view",
    /** Fork: the user's settings, a section of them beside the column that lists them. */
    Settings = "settings",
    /** Fork: the Stream, every room's messages merged by time (MEO-44). */
    Stream = "stream",
}

export default PageType;

package com.kreativekoala.summaryai.util

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TestInstallTest {
    /** A release build, installed by Google Play, on an ordinary phone. */
    private val person = TestInstall.Facts(
        debugBuild = false, testLab = false, hardware = "qcom", installerKnown = true, installer = "com.android.vending",
    )

    @Test fun aPlayInstallOnAPhoneIsAPerson() = assertFalse(TestInstall.isTest(person))

    @Test fun debugTestLabAndEmulatorsAreNot() {
        assertTrue(TestInstall.isTest(person.copy(debugBuild = true)))
        assertTrue(TestInstall.isTest(person.copy(testLab = true)))
        assertTrue(TestInstall.isTest(person.copy(hardware = "ranchu")))
        assertTrue(TestInstall.isTest(person.copy(hardware = "goldfish")))
    }

    @Test fun anAdbInstallIsNot() {
        assertTrue(TestInstall.isTest(person.copy(installer = null)))
        assertTrue(TestInstall.isTest(person.copy(installer = "com.android.shell")))
    }

    @Test fun otherStoresAndHandOpenedFilesStayPeople() {
        for (installer in listOf("com.sec.android.app.samsungapps", "com.google.android.packageinstaller", "com.sec.android.easyMover")) {
            assertFalse(installer, TestInstall.isTest(person.copy(installer = installer)))
        }
    }

    @Test fun anInstallerThatCannotBeReadStaysAPerson() =
        assertFalse(TestInstall.isTest(person.copy(installerKnown = false, installer = null)))
}

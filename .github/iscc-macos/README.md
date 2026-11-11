# ISCC macOS builds

The fork's [release workflow](../workflows/sync-upstream-release.yml) merges each
published add-on release, then builds it against the pinned ISCC 1.2.0 source.
Download a ZIP ending in `-notarized.zip` from the fork’s
[Releases page](https://github.com/sy1544/iscc-bml-sml/releases). Choose `arm64`
for Apple Silicon or `x64` for Intel. These builds use Developer ID signing and
include a stapled Apple notarization ticket.

The app includes the Level Track BML/SML panel, MT5 management and account
settings, and the candle renderer. BML/SML and MT5 start disabled. A compatible
Windows MT5 receiver and the user's connection details are required. The
receiver sources, matching indicator, and example client settings are in the
app's `extensions/iscc-mt5-vps` directory within `Contents/Resources/app.asar`.

For a new Mac profile, copy the example client settings to
`~/Library/Application Support/ISCC/config/mt5-vps.json`, fill in the VPS
account, HTTPS endpoint, broker symbols, and TLS/authentication settings, and
restrict the file to your user. Keep credentials local. The kit's secure
configuration supports `secureAuthFile` and `clientCertFile` for mTLS. Set
`enabled` to true and restart to connect. Keep `tradingEnabled` false during
receiver and account verification. See the [kit integration guide](../../AGENT_INSTALL.md)
for receiver capabilities and demo checks. Level rendering can be configured
separately in the app settings after connecting the receiver.

If an upstream kit changes the integration hooks, the build fails until the
overlay is adapted. The workflow publishes a release only after both architectures
pass.

## Configure signing and notarization

Add these repository secrets under **Settings → Secrets and variables →
Actions**.

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64-encoded `.p12` exported from Keychain Access. Include the **Developer ID Application** certificate and its matching private key. |
| `CSC_KEY_PASSWORD` | The password set when exporting the `.p12`. |
| `APPLE_API_KEY_BASE64` | Base64-encoded `AuthKey_<KeyID>.p8` from an App Store Connect **team API key**. |
| `APPLE_API_KEY_ID` | The Key ID for that team key. |
| `APPLE_API_ISSUER` | The Issuer ID UUID from the Team Keys page in App Store Connect. |

The Apple Developer Program Account Holder can create the Developer ID
certificate. In App Store Connect, go to **Users and Access → Integrations →
App Store Connect API → Team Keys** to generate the notarization key. An Account
Holder or Admin can create the key with the Developer role.
[Developer ID](https://developer.apple.com/developer-id/) ·
[App Store Connect API keys](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/)

On macOS, use `base64 -i filename | tr -d '\n' | pbcopy` to copy the encoded
file directly into the matching GitHub secret. Use GitHub’s secret form for
the password, Key ID, and Issuer ID.

In **Actions → Sync upstream releases and build macOS**, select **Run
workflow** after adding the secrets. It rebuilds the latest upstream release,
checks the signatures and notarization tickets, and adds both notarized ZIPs
to the release. Existing downloads remain available under their original names.

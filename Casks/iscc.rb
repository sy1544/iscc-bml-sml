cask "iscc" do
  arch arm: "arm64", intel: "x64"

  version "0.4.0"
  sha256 arm:   "f7791095807e822966dcfee3f952ea575acb5b260f0b48d531e0de37b8339b5f",
         intel: "970cbb4a0c29cf27b9a4b25ab948a2f31d1dd8539ddca23c1e73871456581a07"

  url "https://github.com/sy1544/iscc-bml-sml/releases/download/v#{version}/ISCC-macos-#{arch}-notarized.zip"
  name "ISCC"
  desc "Trading execution gateway with BML/SML support"
  homepage "https://github.com/sy1544/iscc-bml-sml"

  depends_on :macos

  app "ISCC.app"
end

cask "iscc" do
  arch arm: "arm64", intel: "x64"

  version "0.4.1"
  sha256 arm:   "f70c4dab94245d1db4abb739a9e56bf981869cb0b215e33596cebec0959a8a16",
         intel: "f21c3ba13dd6e77f2ec41dba206c7ca73d79f1cd2f75c2e9d52879b49df2f9f1"

  url "https://github.com/sy1544/iscc-bml-sml/releases/download/v#{version}/ISCC-macos-#{arch}-notarized.zip"
  name "ISCC"
  desc "Trading execution gateway with BML/SML support"
  homepage "https://github.com/sy1544/iscc-bml-sml"

  depends_on :macos

  app "ISCC.app"
end

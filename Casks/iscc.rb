cask "iscc" do
  arch arm: "arm64", intel: "x64"

  version "0.4.2"
  sha256 arm:   "50e3c96c16230d461314055cc281ca9fffe6b689848679e794f09e8723eefd99",
         intel: "6dc7b829de6f87bd15f0d4dbbba1d7f087139474e82d784f30b0771dc2ef9b5a"

  url "https://github.com/sy1544/iscc-bml-sml/releases/download/v#{version}/ISCC-macos-#{arch}-notarized.zip"
  name "ISCC"
  desc "Trading execution gateway with BML/SML support"
  homepage "https://github.com/sy1544/iscc-bml-sml"

  depends_on :macos

  app "ISCC.app"
end

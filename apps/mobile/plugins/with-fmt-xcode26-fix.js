/**
 * Xcode 16.3+ / Xcode 26 + React Native 0.76 에서 발생하는
 *   Pods/fmt/include/fmt/format-inl.h:1391:33:
 *   "call to consteval function ... is not a constant expression"
 * 에러를 우회하기 위한 config plugin.
 *
 * 원인: Clang 20+ 이 consteval 평가를 더 엄격하게 하면서 fmt 9.x (RN 0.76 번들)의
 *      FMT_STRING 매크로가 깨짐. fmt 10+ 로 업그레이드하거나 해당 파일들을
 *      C++17 로 내려 컴파일하면 회피 가능.
 *
 * 조치: Podfile 의 post_install hook 에 아래 설정 주입.
 *       React-Core / fmt / RCT-Folly 타겟의 CLANG_CXX_LANGUAGE_STANDARD 를
 *       `c++17` 로 강제. fmt 와 folly 는 RN 0.76 에선 C++17 기반이므로 문제 없음.
 *
 * 참고: https://github.com/facebook/react-native/issues/48478 외 다수.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const POST_INSTALL_SNIPPET = `
    # ───── Xcode 16.3+ fmt consteval fix (injected by with-fmt-xcode26-fix) ─────
    # Xcode 26 / Clang 20+ 이 fmt 11.x 의 FMT_STRING + consteval 조합을 거부한다.
    # fmt/base.h 의 "__apple_build_version__ < 14000029L" 조건을 모든 Apple clang 에 적용
    # (즉 버전 비교 제거) 해 FMT_USE_CONSTEVAL 을 항상 0 으로 내린다.
    fmt_base_h = File.join(__dir__, 'Pods', 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base_h)
      content = File.read(fmt_base_h)
      marker = '// with-fmt-xcode26-fix applied'
      unless content.include?(marker)
        patched = content.sub(
          /#elif defined\\(__apple_build_version__\\) && __apple_build_version__ < \\d+L/,
          "#{marker}\\n#elif defined(__apple_build_version__)  // force-disable consteval on all Apple clang",
        )
        if patched != content
          File.write(fmt_base_h, patched)
          puts '[with-fmt-xcode26-fix] Patched Pods/fmt/include/fmt/base.h (disable consteval on Apple clang)'
        end
      end
    end
    # ───── end Xcode 16.3+ fmt fix ─────
`;

function patchPodfile(contents) {
  if (contents.includes('with-fmt-xcode26-fix')) {
    return contents; // 이미 적용됨
  }
  // post_install do |installer| 블록의 시작 직후에 주입.
  // (블록 끝 `end` 를 정규식으로 찾기보다 시작 바로 뒤에 붙이는 게 안전)
  const marker = /^(\s*)post_install do \|installer\|\n/m;
  if (!marker.test(contents)) {
    // post_install 블록이 없으면 파일 끝에 새로 추가
    return contents + `\n\npost_install do |installer|${POST_INSTALL_SNIPPET}end\n`;
  }
  return contents.replace(marker, (full, indent) => `${full}${POST_INSTALL_SNIPPET}`);
}

module.exports = function withFmtXcode26Fix(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) return cfg;
      const contents = fs.readFileSync(podfilePath, 'utf8');
      const patched = patchPodfile(contents);
      if (patched !== contents) {
        fs.writeFileSync(podfilePath, patched);
      }
      return cfg;
    },
  ]);
};

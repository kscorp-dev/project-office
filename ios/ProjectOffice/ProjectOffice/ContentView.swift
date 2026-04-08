import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            // 전자결재
            Text("전자결재")
                .tabItem {
                    Image(systemName: "doc.text")
                    Text("결재")
                }

            // 메신저
            Text("메신저")
                .tabItem {
                    Image(systemName: "message")
                    Text("메신저")
                }

            // CCTV
            Text("CCTV")
                .tabItem {
                    Image(systemName: "video")
                    Text("CCTV")
                }

            // 설정
            Text("설정")
                .tabItem {
                    Image(systemName: "gear")
                    Text("설정")
                }
        }
    }
}

#Preview {
    ContentView()
}

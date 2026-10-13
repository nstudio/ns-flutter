import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_views/main.dart';

void main() {
  testWidgets('NexusCoexistenceSurfaceApp mounts cleanly', (WidgetTester tester) async {
    await tester.pumpWidget(const NexusCoexistenceSurfaceApp());
    expect(find.byType(NexusCoexistenceSurfaceApp), findsOneWidget);
  });
}

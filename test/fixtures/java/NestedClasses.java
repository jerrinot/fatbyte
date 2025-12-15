package fixtures;

public class NestedClasses {
    public class Inner {
        public void innerMethod() {}
    }

    public static class StaticNested {
        public void nestedMethod() {}
    }

    public void methodWithAnonymous() {
        Runnable r = new Runnable() {
            public void run() {
                System.out.println("anonymous");
            }
        };
        r.run();
    }
}

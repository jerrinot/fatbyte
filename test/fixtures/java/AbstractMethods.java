package fixtures;

public abstract class AbstractMethods {
    public abstract void abstractMethod();

    public native void nativeMethod();

    public void concreteMethod() {
        System.out.println("concrete");
    }
}

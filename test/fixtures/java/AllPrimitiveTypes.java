package fixtures;

public class AllPrimitiveTypes {
    public void voidMethod() {}
    public byte byteMethod() { return 0; }
    public char charMethod() { return 'a'; }
    public short shortMethod() { return 0; }
    public int intMethod() { return 0; }
    public long longMethod() { return 0L; }
    public float floatMethod() { return 0.0f; }
    public double doubleMethod() { return 0.0; }
    public boolean booleanMethod() { return false; }
    public int[] intArrayMethod() { return new int[0]; }
    public String[][] multiDimMethod() { return new String[0][0]; }

    public void allParamTypes(byte a, char b, short c, int d, long e,
                               float f, double g, boolean h, Object i) {}
}

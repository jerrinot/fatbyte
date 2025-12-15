package fixtures;

public class WithLongDouble {
    public long getLongValue() {
        return 9223372036854775807L;  // Long.MAX_VALUE - forces CONSTANT_Long
    }

    public double getDoubleValue() {
        return 3.141592653589793;      // Forces CONSTANT_Double
    }

    public double compute(long a, double b) {
        return a * b + 1.0;
    }
}

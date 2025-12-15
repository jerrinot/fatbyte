package fixtures;

import java.util.function.Function;
import java.util.function.Supplier;

public class LambdasAndIndy {
    public Supplier<String> getSupplier() {
        return () -> "hello";
    }

    public Function<Integer, Integer> getDoubler() {
        return x -> x * 2;
    }

    public int sumWithLambda(int[] values) {
        return java.util.Arrays.stream(values).sum();
    }
}

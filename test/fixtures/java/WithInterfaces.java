package fixtures;

import java.io.Serializable;

public class WithInterfaces implements Serializable, Comparable<WithInterfaces> {
    private int id;

    public int compareTo(WithInterfaces other) {
        return Integer.compare(this.id, other.id);
    }
}

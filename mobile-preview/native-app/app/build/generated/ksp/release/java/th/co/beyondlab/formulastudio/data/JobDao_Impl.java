package th.co.beyondlab.formulastudio.data;

import android.database.Cursor;
import androidx.annotation.NonNull;
import androidx.room.EntityInsertionAdapter;
import androidx.room.RoomDatabase;
import androidx.room.RoomSQLiteQuery;
import androidx.room.SharedSQLiteStatement;
import androidx.room.util.CursorUtil;
import androidx.room.util.DBUtil;
import androidx.sqlite.db.SupportSQLiteStatement;
import java.lang.Class;
import java.lang.Long;
import java.lang.Override;
import java.lang.String;
import java.lang.SuppressWarnings;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import javax.annotation.processing.Generated;

@Generated("androidx.room.RoomProcessor")
@SuppressWarnings({"unchecked", "deprecation"})
public final class JobDao_Impl implements JobDao {
  private final RoomDatabase __db;

  private final EntityInsertionAdapter<JobRow> __insertionAdapterOfJobRow;

  private final EntityInsertionAdapter<MetaRow> __insertionAdapterOfMetaRow;

  private final SharedSQLiteStatement __preparedStmtOfRemove;

  public JobDao_Impl(@NonNull final RoomDatabase __db) {
    this.__db = __db;
    this.__insertionAdapterOfJobRow = new EntityInsertionAdapter<JobRow>(__db) {
      @Override
      @NonNull
      protected String createQuery() {
        return "INSERT OR REPLACE INTO `jobs` (`id`,`json`) VALUES (?,?)";
      }

      @Override
      protected void bind(@NonNull final SupportSQLiteStatement statement,
          @NonNull final JobRow entity) {
        statement.bindString(1, entity.getId());
        statement.bindString(2, entity.getJson());
      }
    };
    this.__insertionAdapterOfMetaRow = new EntityInsertionAdapter<MetaRow>(__db) {
      @Override
      @NonNull
      protected String createQuery() {
        return "INSERT OR REPLACE INTO `meta` (`key`,`value`) VALUES (?,?)";
      }

      @Override
      protected void bind(@NonNull final SupportSQLiteStatement statement,
          @NonNull final MetaRow entity) {
        statement.bindString(1, entity.getKey());
        statement.bindLong(2, entity.getValue());
      }
    };
    this.__preparedStmtOfRemove = new SharedSQLiteStatement(__db) {
      @Override
      @NonNull
      public String createQuery() {
        final String _query = "DELETE FROM jobs WHERE id = ?";
        return _query;
      }
    };
  }

  @Override
  public void put(final JobRow r) {
    __db.assertNotSuspendingTransaction();
    __db.beginTransaction();
    try {
      __insertionAdapterOfJobRow.insert(r);
      __db.setTransactionSuccessful();
    } finally {
      __db.endTransaction();
    }
  }

  @Override
  public void putMeta(final MetaRow m) {
    __db.assertNotSuspendingTransaction();
    __db.beginTransaction();
    try {
      __insertionAdapterOfMetaRow.insert(m);
      __db.setTransactionSuccessful();
    } finally {
      __db.endTransaction();
    }
  }

  @Override
  public void remove(final String id) {
    __db.assertNotSuspendingTransaction();
    final SupportSQLiteStatement _stmt = __preparedStmtOfRemove.acquire();
    int _argIndex = 1;
    _stmt.bindString(_argIndex, id);
    try {
      __db.beginTransaction();
      try {
        _stmt.executeUpdateDelete();
        __db.setTransactionSuccessful();
      } finally {
        __db.endTransaction();
      }
    } finally {
      __preparedStmtOfRemove.release(_stmt);
    }
  }

  @Override
  public List<JobRow> all() {
    final String _sql = "SELECT * FROM jobs ORDER BY id";
    final RoomSQLiteQuery _statement = RoomSQLiteQuery.acquire(_sql, 0);
    __db.assertNotSuspendingTransaction();
    final Cursor _cursor = DBUtil.query(__db, _statement, false, null);
    try {
      final int _cursorIndexOfId = CursorUtil.getColumnIndexOrThrow(_cursor, "id");
      final int _cursorIndexOfJson = CursorUtil.getColumnIndexOrThrow(_cursor, "json");
      final List<JobRow> _result = new ArrayList<JobRow>(_cursor.getCount());
      while (_cursor.moveToNext()) {
        final JobRow _item;
        final String _tmpId;
        _tmpId = _cursor.getString(_cursorIndexOfId);
        final String _tmpJson;
        _tmpJson = _cursor.getString(_cursorIndexOfJson);
        _item = new JobRow(_tmpId,_tmpJson);
        _result.add(_item);
      }
      return _result;
    } finally {
      _cursor.close();
      _statement.release();
    }
  }

  @Override
  public Long counter() {
    final String _sql = "SELECT value FROM meta WHERE `key` = 'counter'";
    final RoomSQLiteQuery _statement = RoomSQLiteQuery.acquire(_sql, 0);
    __db.assertNotSuspendingTransaction();
    final Cursor _cursor = DBUtil.query(__db, _statement, false, null);
    try {
      final Long _result;
      if (_cursor.moveToFirst()) {
        if (_cursor.isNull(0)) {
          _result = null;
        } else {
          _result = _cursor.getLong(0);
        }
      } else {
        _result = null;
      }
      return _result;
    } finally {
      _cursor.close();
      _statement.release();
    }
  }

  @NonNull
  public static List<Class<?>> getRequiredConverters() {
    return Collections.emptyList();
  }
}
